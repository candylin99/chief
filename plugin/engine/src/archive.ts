// 归档：办完的旧东西搬进 ~/chief/data/archive/<种类>-<年月>.jsonl，常用的文件就一直不大
// （面板每次刷新、chief 命令每次运行都把它们整个读一遍）。
// 只搬判断过、办完、发完超过 keepDays 天的：没判断的事件、还在办的事情、开着的问题、没发完或没发出去的回复都留着。
// 先追加到归档再重写原文件：中途断了，最坏是归档里多一份，不会丢。
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config";
import { loadDispatch, paths, readEvents, updateJson, updateReplies, withLock, type Decision, type ChiefEvent, type ThingsFile } from "./store";

// 留几天：config.json 的 keepDays（默认 7）。
export const keepDays = () => config().keepDays;

function put(kind: string, rows: { month: string; row: unknown }[]): void {
  if (rows.length === 0) return;
  mkdirSync(paths().archive, { recursive: true, mode: 0o700 });
  const byMonth = new Map<string, string[]>();
  for (const r of rows) byMonth.set(r.month, [...(byMonth.get(r.month) ?? []), JSON.stringify(r.row)]);
  for (const [month, lines] of byMonth) appendFileSync(join(paths().archive, `${kind}-${month}.jsonl`), `${lines.join("\n")}\n`, { mode: 0o600 });
}

const monthOf = (at: string | undefined) => (at && /^\d{4}-\d{2}/.test(at) ? at.slice(0, 7) : "unknown");

export function rewriteLines(file: string, rows: unknown[]): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, rows.map((r) => `${JSON.stringify(r)}\n`).join(""), { mode: 0o600 });
  renameSync(tmp, file);
}

export function readLines<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").flatMap((l) => {
    try {
      return l.trim() ? [JSON.parse(l) as T] : [];
    } catch {
      return [];
    }
  });
}

// 搬一次，返回各种搬了几条。
export function archiveOld(now = Date.now(), days = keepDays()): Record<"events" | "decisions" | "things" | "asks" | "replies", number> {
  const cutoff = now - days * 86_400_000;
  const old = (at: string | undefined) => at !== undefined && Date.parse(at) < cutoff;
  const out = { events: 0, decisions: 0, things: 0, asks: 0, replies: 0 };

  // 事件：判断过、判断的时间早于 7 天前的。造事件的地方（引擎、chief test、演练）都拿着 state 的锁追加，这里也拿它。
  withLock(paths().state, () => {
    const dispatch = loadDispatch();
    const all = readEvents();
    const gone = all.filter((e) => old(dispatch[e.id]?.at));
    if (gone.length === 0) return;
    put("events", gone.map((e) => ({ month: monthOf(dispatch[e.id]!.at), row: e })));
    const ids = new Set(gone.map((e) => e.id));
    rewriteLines(paths().events, all.filter((e) => !ids.has(e.id)));
    out.events = gone.length;
  });

  withLock(paths().decisions, () => {
    const all = readLines<Decision>(paths().decisions);
    const gone = all.filter((d) => old(d.at));
    if (gone.length === 0) return;
    put("decisions", gone.map((d) => ({ month: monthOf(d.at), row: d })));
    rewriteLines(paths().decisions, all.filter((d) => !old(d.at)));
    out.decisions = gone.length;
  });

  // 事情：办完或不做了、7 天没动的；连同它的问题。还在办的事情上答过的旧问题也搬。
  updateJson<ThingsFile, void>(paths().things, { nextThing: 1, nextAsk: 1, things: [], asks: [] }, (t) => {
    const gone = t.things.filter((x) => (x.status === "done" || x.status === "dropped") && old(x.updatedAt));
    const ids = new Set(gone.map((x) => x.id));
    const asks = t.asks.filter((a) => ids.has(a.thing) || (a.status !== "open" && old(a.closedAt ?? a.at)));
    put("things", gone.map((x) => ({ month: monthOf(x.updatedAt), row: x })));
    put("asks", asks.map((a) => ({ month: monthOf(a.at), row: a })));
    const askIds = new Set(asks.map((a) => a.id));
    t.things = t.things.filter((x) => !ids.has(x.id));
    t.asks = t.asks.filter((a) => !askIds.has(a.id));
    out.things = gone.length;
    out.asks = asks.length;
  });

  // 回复：发出去了或你说不发的、7 天前的。没发出去的（failed）留着等你看。
  updateReplies((r) => {
    const gone = r.items.filter((x) => (x.status === "sent" || x.status === "dropped") && old(x.sentAt ?? x.at));
    const ids = new Set(gone.map((x) => x.id));
    put("replies", gone.map((x) => ({ month: monthOf(x.sentAt ?? x.at), row: x })));
    r.items = r.items.filter((x) => !ids.has(x.id));
    out.replies = gone.length;
  });
  return out;
}

// 归档里找一条事件（chief show、存成例子用得到老事件）。
export function archivedEvent(id: number): ChiefEvent | null {
  if (!existsSync(paths().archive)) return null;
  for (const f of readdirSync(paths().archive).filter((x) => x.startsWith("events-")).sort().reverse()) {
    const hit = readLines<ChiefEvent>(join(paths().archive, f)).find((e) => e.id === id);
    if (hit) return hit;
  }
  return null;
}
