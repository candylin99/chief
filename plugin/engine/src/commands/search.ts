// chief search <字> [--limit N] [--kind thing|ask|reply|event|decision]：在现在的数据和归档里找以前的事（「之前那个 xx 怎么样了」）。
// 不分大小写、按字面找：事情的标题、进展、下一步、阻碍、结果、进展记录；问题和回答；回复正文和对方原话；消息的标题、谁说的、原文；判断的理由。
// 一行一条 JSON，新的在前。
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readLines } from "../archive";
import { fail, flag, num } from "../args";
import { loadDecisions, loadReplies, loadThings, paths, readEvents, type Ask, type ChiefEvent, type Decision, type Reply, type SearchHit, type Thing } from "../store";

export const SEARCH_KINDS = ["thing", "ask", "reply", "event", "decision"] as const;
type Kind = SearchHit["kind"];

// 对上的那一段：前面留一点、后面多留一点，压成一行。
export function snippetOf(text: string, q: string, max = 100): string | null {
  const flat = text.replace(/\s+/g, " ").trim();
  const i = flat.toLowerCase().indexOf(q);
  if (i < 0) return null;
  const start = Math.max(0, i - 30);
  const end = Math.min(flat.length, Math.max(i + q.length, start + max));
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}

// 一样东西的几段字里，第一段对上的。
function first(q: string, ...texts: (string | null | undefined)[]): string | null {
  for (const t of texts) {
    if (!t) continue;
    const s = snippetOf(t, q);
    if (s !== null) return s;
  }
  return null;
}

// 归档里某一种的全部（按月一个文件，见 archive.ts）。
function archived<T>(kind: string): T[] {
  const dir = paths().archive;
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.startsWith(`${kind}-`) && f.endsWith(".jsonl")).sort().flatMap((f) => readLines<T>(join(dir, f)));
}

const urlIn = (text: string | undefined) => /https?:\/\/[^\s)\]>]+/.exec(text ?? "")?.[0];

export function search(query: string, kinds: readonly Kind[] = SEARCH_KINDS): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  // 现在的在前，归档的同一条（中途断了可能两边都有）不重复。
  const seen = new Set<string>();
  const add = (h: SearchHit | null) => {
    if (!h || seen.has(`${h.kind}:${h.id}`)) return;
    seen.add(`${h.kind}:${h.id}`);
    hits.push(h);
  };
  const want = (k: Kind) => kinds.includes(k);
  const t = loadThings();
  const oldThings = archived<Thing>("things");
  const thingOf = new Map<number, Thing>();
  for (const x of [...t.things, ...oldThings]) if (!thingOf.has(x.id)) thingOf.set(x.id, x);

  if (want("thing")) {
    const one = (x: Thing, old: boolean): SearchHit | null => {
      const s = first(q, x.title, x.progress, x.next, x.blocker, ...(x.results ?? []), ...[...x.log].reverse().map((l) => l.text));
      if (s === null) return null;
      const url = (x.results ?? []).map(urlIn).find(Boolean);
      return { kind: "thing", id: x.id, date: x.updatedAt, title: x.title, snippet: s, ...(url ? { url } : {}), thing: x.id, ...(x.session ? { session: x.session } : {}), ...(old ? { archived: true } : {}) };
    };
    for (const x of t.things) add(one(x, false));
    for (const x of oldThings) add(one(x, true));
  }
  if (want("ask")) {
    const one = (a: Ask, old: boolean): SearchHit | null => {
      const s = first(q, a.question, a.suggest, a.answer);
      if (s === null) return null;
      const x = thingOf.get(a.thing);
      return { kind: "ask", id: a.id, date: a.at, title: x?.title ?? "要你定", snippet: s, thing: a.thing, ...(x?.session ? { session: x.session } : {}), ...(old ? { archived: true } : {}) };
    };
    for (const a of t.asks) add(one(a, false));
    for (const a of archived<Ask>("asks")) add(one(a, true));
  }
  if (want("reply")) {
    const one = (r: Reply, old: boolean): SearchHit | null => {
      const s = first(q, r.body, r.context.said, r.context.who, r.context.where);
      if (s === null) return null;
      const x = r.thing === undefined ? undefined : thingOf.get(r.thing);
      const url = r.url ?? r.context.url ?? undefined;
      const title = r.kind === "approve" ? `approve ${r.target.ref ?? "PR"}` : `${r.kind === "message" ? "发给" : "回"} ${r.context.who ?? r.context.where}`;
      return { kind: "reply", id: r.id, date: r.sentAt ?? r.at, title, snippet: s, ...(url ? { url } : {}), ...(r.thing !== undefined ? { thing: r.thing } : {}), ...(x?.session ? { session: x.session } : {}), ...(old ? { archived: true } : {}) };
    };
    for (const r of loadReplies().items) add(one(r, false));
    for (const r of archived<Reply>("replies")) add(one(r, true));
  }
  if (want("event")) {
    const one = (e: ChiefEvent, old: boolean): SearchHit | null => {
      // 演练消息、chief 自己造的提醒（漏掉了、撤回了、到点了）不算。
      if (e.dryrun || e.kind.startsWith("chief.") || e.kind === "thing.woke") return null;
      const s = first(q, e.title, e.text, e.from);
      if (s === null) return null;
      return { kind: "event", id: e.id, date: e.at, title: `${e.title}${e.from ? `（${e.from}）` : ""}`, snippet: s, ...(e.url ? { url: e.url } : {}), ...(old ? { archived: true } : {}) };
    };
    for (const e of readEvents()) add(one(e, false));
    for (const e of archived<ChiefEvent>("events")) add(one(e, true));
  }
  if (want("decision")) {
    // 判断：一条消息可能判断过几次（--force），只留最新的那次。
    const one = (d: Decision, old: boolean): SearchHit | null => {
      if (d.dry) return null;
      const s = first(q, d.reason, d.what?.title, d.what?.text);
      if (s === null) return null;
      const x = d.thing === undefined ? undefined : thingOf.get(d.thing);
      return { kind: "decision", id: d.event, date: d.at, title: d.what ? `${d.what.title}${d.what.from ? `（${d.what.from}）` : ""}` : "判断", snippet: s, ...(d.thing !== undefined ? { thing: d.thing } : {}), ...((d.session ?? x?.session) ? { session: d.session ?? x!.session! } : {}), ...(old ? { archived: true } : {}) };
    };
    for (const d of [...loadDecisions()].reverse()) add(one(d, false));
    for (const d of archived<Decision>("decisions").reverse()) add(one(d, true));
  }
  return hits.sort((a, b) => b.date.localeCompare(a.date));
}

export function searchCmd(args: string[]): void {
  // -- 以后的都是要找的字（面板这么传：字里有 --limit 也不会被当成参数）。
  const cut = args.indexOf("--");
  const tail = cut < 0 ? [] : args.splice(cut).slice(1);
  const limit = num(flag(args, "--limit") ?? "20", "--limit ");
  const kindFlag = flag(args, "--kind");
  if (kindFlag !== null && !SEARCH_KINDS.includes(kindFlag as Kind)) fail(`--kind 是 ${SEARCH_KINDS.join("|")} 之一`);
  const query = [...args, ...tail].join(" ").trim();
  if (!query) fail("chief search <要找的字> [--limit N] [--kind thing|ask|reply|event|decision]");
  if (query.length > 200) fail("要找的字太长了");
  const hits = search(query, kindFlag ? [kindFlag as Kind] : SEARCH_KINDS).slice(0, Math.max(1, Math.min(limit, 500)));
  process.stdout.write(hits.map((h) => `${JSON.stringify(h)}\n`).join(""));
}
