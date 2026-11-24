// 免打扰和每天汇总：chief quiet / chief digest。
import { flag, num } from "../args";
import { quietNow, heldSince } from "../quiet";
import { liveConfig } from "../config";
import { dateKey } from "../shared/schedule";
import { loadDispatch, loadReplies, loadThings, readEvents, type ChiefEvent } from "../store";

// chief quiet：现在是不是免打扰、到几点（JSON）。主会话推送前先看一眼。
export function quiet(): void {
  const q = quietNow();
  process.stdout.write(`${JSON.stringify({ quiet: q.quiet, until: q.until, hours: q.hours })}\n`);
}

const cut = (text: string | undefined, max = 120) => {
  const one = (text ?? "").replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
};

// 上一份汇总：编号小于 before 的最后一条 digest 事件的时间；没有就往回看一天。
export function digestSince(events: readonly ChiefEvent[], before: number, now: Date): string {
  const last = events.filter((e) => e.kind === "digest" && e.source === "chief" && e.id < before).at(-1);
  return last?.at ?? new Date(now.getTime() - 86_400_000).toISOString();
}

// 写汇总要的材料，一次给全：等你的事、开着的问题、待发出、上一份以后的变化、免打扰时没弹的提醒。
export function digestMaterial(opts: { event?: number; since?: string; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const events = readEvents();
  const current = opts.event === undefined ? undefined : events.find((e) => e.id === opts.event && e.kind === "digest");
  const since = opts.since ?? digestSince(events, opts.event ?? Number.MAX_SAFE_INTEGER, now);
  const t = loadThings();
  const live = t.things.filter((x) => x.status === "doing" || x.status === "waiting_you" || x.status === "waiting_others");
  const titleOf = new Map(t.things.map((x) => [x.id, x.title]));
  const soon = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2));
  const row = (x: (typeof t.things)[number]) => ({ id: x.id, title: x.title, status: x.status, progress: cut(x.progress), ...(x.next ? { next: cut(x.next) } : {}), ...(x.blocker ? { blocker: cut(x.blocker) } : {}), ...(x.due ? { due: x.due } : {}) });
  const asks = t.asks.filter((a) => a.status === "open").map((a) => ({ id: a.id, thing: titleOf.get(a.thing) ?? null, question: cut(a.question, 200), at: a.at }));
  const outbox = loadReplies().items.filter((r) => r.status === "pending" || r.status === "failed")
    .map((r) => ({ id: r.id, status: r.status, kind: r.kind ?? "reply", who: r.context.who, where: r.context.where, body: cut(r.body), ...(r.error ? { error: cut(r.error) } : {}), at: r.at }));
  const handled = loadDispatch();
  const fresh = events.filter((e) => e.at > since && !e.dryrun && e.source !== "chief" && e.kind !== "chief.missed");
  const bySource: Record<string, number> = {};
  for (const e of fresh) bySource[e.source] = (bySource[e.source] ?? 0) + 1;
  const changed = t.things.filter((x) => x.updatedAt > since);
  const held = heldSince(since).map((x) => ({ at: x.at, title: x.title, body: cut(x.body, 160) }));
  return {
    now: now.toISOString(),
    since,
    slot: current?.why[0] ?? null,
    quiet: quietNow(now),
    digest: liveConfig().digest,
    counts: {
      waitingYou: live.filter((x) => x.status === "waiting_you").length,
      doing: live.filter((x) => x.status === "doing").length,
      waitingOthers: live.filter((x) => x.status === "waiting_others").length,
      asks: asks.length,
      outbox: outbox.length,
      newEvents: fresh.length,
      unhandled: events.filter((e) => !handled[e.id] && !e.dryrun).length,
      changed: changed.length,
      held: held.length,
    },
    waitingYou: live.filter((x) => x.status === "waiting_you").map(row),
    due: live.filter((x) => x.due !== undefined && x.due <= soon).sort((a, b) => a.due!.localeCompare(b.due!)).map(row),
    blocked: live.filter((x) => x.blocker).map(row),
    asks,
    outbox,
    changed: changed.map((x) => ({ ...row(x), updatedAt: x.updatedAt, recent: x.log.filter((l) => l.at > since).slice(-3).map((l) => cut(l.text)) })),
    events: { total: fresh.length, bySource },
    held,
  };
}

// chief digest [--event N] [--since 时间]：写汇总的材料（JSON）。--event 是那条 digest 事件（从上一份汇总算起）。
export function digest(args: string[]): void {
  const ev = flag(args, "--event");
  const since = flag(args, "--since");
  if (since !== null && Number.isNaN(Date.parse(since))) throw new Error("--since 要是时间，比如 2026-11-23T08:00:00Z");
  const out = digestMaterial({ ...(ev !== null ? { event: num(ev, "--event ") } : {}), ...(since !== null ? { since: new Date(since).toISOString() } : {}) });
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}
