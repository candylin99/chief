// 通知：主会话「只记下」的 Slack 消息（私信、@我、我在的 thread 的后续：告知、状态同步这类），面板上出一张轻量的卡。
// 你点「已读 👀」：chief notice read 把它排上（queued），引擎下一轮以你的身份在那条 Slack 原消息上加 :eyes:（和发回复一样走引擎，不经过主会话），
// 加上了标 done，加不上（消息删了、没权限、Slack 没连上）标 failed 记下为什么。已经加过的、重复点的都只算一次。
// 只做 Slack：GitHub、Jira 的通知没有对应的表情。@here / @channel 群发的、忽略的不出卡。
// 一段对话（thread / 私信）在面板上只一张卡：点已读只在最新那条上加 :eyes:，同一段里更早没看的跟着算看过（covered），不一条条加。
import { keysOf } from "./keys";
import { messageUrl } from "./links";
import { prKeyOfRef } from "./sweep";
import { loadDecisions, loadSettings, paths, readEvents, readJson, updateJson } from "./store";
import type { ChiefEvent, LinksFile, Notice, NoticesFile, Reply } from "./shared/types";

export const EMPTY_NOTICES: NoticesFile = { items: [] };
// 最多留多少条；看过的（done）7 天后清掉。
const MAX_NOTICES = 300;
const KEEP_DONE_MS = 7 * 86_400_000;
const BROADCAST = /(^|\s)@(here|channel|everyone)\b/i;
const NOTICE_WHY = new Set(["dm", "mention", "thread"]);

export function loadNotices(): NoticesFile {
  return { ...EMPTY_NOTICES, ...readJson<Partial<NoticesFile>>(paths().notices, {}) } as NoticesFile;
}

export function updateNotices<T>(fn: (n: NoticesFile) => T): T {
  return updateJson<NoticesFile, T>(paths().notices, { items: [] }, (n) => {
    if (!Array.isArray(n.items)) n.items = [];
    return fn(n);
  });
}

// 这条事件该不该出通知卡：Slack 的、别人发的、私信 / @我 / 我在的 thread，不是群发，能定位到原消息。
export function noticeWorthy(e: ChiefEvent): boolean {
  return e.source === "slack" && e.kind === "message.received" && !e.dryrun && e.why.some((w) => NOTICE_WHY.has(w))
    && Boolean(e.reply.channel && e.reply.ts) && !BROADCAST.test(e.text);
}

export function convOf(e: ChiefEvent): string {
  return e.keys[0]?.startsWith("slack:") ? e.keys[0] : `slack:${e.reply.channel}`;
}

export function noticeOf(e: ChiefEvent, at: string, thing: number | null, workspace: string | null): Notice {
  return {
    event: e.id, at, who: e.from, where: e.title, text: e.text.replace(/\s+/g, " ").trim().slice(0, 300), url: messageUrl(e, workspace),
    target: { channel: e.reply.channel!, ts: e.reply.ts! }, conv: convOf(e), msgAt: e.at, status: "unread", ...(thing !== null ? { thing } : {}),
  };
}

// chief mark 之后：只记下的出卡（同一条只出一张）；改判成别的（--force 改成派活、忽略）的，还没读的卡撤掉。
export function noteMarked(events: readonly ChiefEvent[], verdict: string, at: string, thing: number | null): void {
  updateNotices((n) => {
    const ids = new Set(events.map((e) => e.id));
    if (verdict !== "noted") {
      n.items = n.items.filter((x) => !(ids.has(x.event) && x.status === "unread"));
      return;
    }
    const workspace = loadSettings().slackWorkspace ?? null;
    for (const e of events) {
      if (!noticeWorthy(e) || n.items.some((x) => x.event === e.id)) continue;
      n.items.push(noticeOf(e, at, thing, workspace));
    }
    prune(n);
  });
}

function prune(n: NoticesFile, now = Date.now()): void {
  n.items = n.items.filter((x) => x.status !== "done" || now - Date.parse(x.readAt ?? x.at) < KEEP_DONE_MS).slice(-MAX_NOTICES);
}

// chief notice read <事件号>：排上加 :eyes:。没读的、上次没加上的才排；已经排上、已经加过的什么都不做（幂等）。
export function queueRead(event: number, now = new Date()): { event: number; status: Notice["status"]; changed: boolean } {
  return updateNotices((n) => {
    const x = n.items.find((y) => y.event === event);
    if (!x) throw new Error(`没有消息 #${event} 的通知`);
    if (x.status === "queued" || x.status === "done") return { event, status: x.status, changed: false };
    x.status = "queued";
    x.queuedAt = now.toISOString();
    delete x.error;
    // 同一段对话里更早还没看的：跟着算看过，不单独加 :eyes:。
    for (const y of n.items) {
      if (y === x || !x.conv || y.conv !== x.conv || (y.status !== "unread" && y.status !== "failed") || y.event > x.event) continue;
      y.status = "done";
      y.covered = true;
      y.readAt = now.toISOString();
      delete y.error;
    }
    return { event, status: x.status, changed: true };
  });
}

// 引擎每一轮：把排上的逐条加 :eyes:。react 出错带 already_reacted 的算加上了（以前加过）。
export async function reactQueued(react: ((target: { channel: string; ts: string }) => Promise<void>) | null, now = () => new Date()): Promise<{ done: number[]; failed: number[] }> {
  // 每秒都跑：先不拿锁看一眼，没有排上的就不碰文件。
  if (!loadNotices().items.some((x) => x.status === "queued")) return { done: [], failed: [] };
  const queued = updateNotices((n) => n.items.filter((x) => x.status === "queued").map((x) => ({ event: x.event, target: { ...x.target } })));
  const done: number[] = [];
  const failed: number[] = [];
  for (const q of queued) {
    let error: string | null = null;
    if (!react) error = "Slack 还没连上，连上了再点一次";
    else {
      try {
        await react(q.target);
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        if (!/already_reacted/i.test(why)) error = why.replace(/\s+/g, " ").slice(0, 160);
      }
    }
    updateNotices((n) => {
      const x = n.items.find((y) => y.event === q.event);
      if (!x || x.status !== "queued") return;
      if (error === null) {
        x.status = "done";
        x.readAt = now().toISOString();
      } else {
        x.status = "failed";
        x.error = error;
      }
    });
    (error === null ? done : failed).push(q.event);
  }
  return { done, failed };
}

// chief notice backfill [--hours 24]：装上通知以前就只记下的消息，补出卡（只补最近这些小时的，已经有卡的不重复）。
export function backfill(hours: number, now = Date.now()): number {
  const since = now - hours * 3600_000;
  const byId = new Map(readEvents().map((e) => [e.id, e]));
  const before = loadNotices().items.length;
  for (const d of loadDecisions()) {
    if (d.dry || d.verdict !== "noted" || Date.parse(d.at) < since) continue;
    const e = byId.get(d.event);
    if (e) noteMarked([e], "noted", d.at, d.thing ?? null);
  }
  return loadNotices().items.length - before;
}

// 已经有回应的通知：不用你再点已读。消息之后——
//   chief 在同一段对话里发出过回复（replied）或 approve（approved），或 approve 了这条消息里链着的 PR；
//   这条消息里链着的 PR 你已经 approve 过、合了、关了（pr，看 links.json）；
//   你自己在这段对话里说过话（self，看 state.json 的 spoke）。
export function handledWhy(n: Notice, ctx: { replies: readonly Reply[]; eventOf: (id: number) => ChiefEvent | null; links: LinksFile; spoke: Record<string, string> }): Notice["handled"] | null {
  const msgAt = n.msgAt ?? ctx.eventOf(n.event)?.at ?? n.at;
  const prs = new Set(keysOf(n.text).filter((k) => k.includes("/pull/")));
  for (const r of ctx.replies) {
    if (r.status !== "sent" || (r.sentAt ?? r.at) < msgAt) continue;
    if (r.kind === "approve") {
      const key = prKeyOfRef(r.target.ref);
      if (key && prs.has(key)) return "approved";
    }
    const e = ctx.eventOf(r.event);
    if (e && n.conv && convOf(e) === n.conv) return r.kind === "approve" ? "approved" : "replied";
  }
  for (const k of prs) {
    const p = ctx.links.prs[k];
    if (p && (p.approvedByMe || p.state !== "open")) return "pr";
  }
  const spoke = n.conv ? ctx.spoke[n.conv] : undefined;
  if (spoke && spoke >= msgAt) return "self";
  return null;
}

// 引擎每分钟（和发出一条回复之后）跑：还没看的通知里，已经有回应的算看过、收起来，不加 :eyes:。返回收了哪些。
export function settleNotices(ctx: Parameters<typeof handledWhy>[1], now = new Date()): number[] {
  if (!loadNotices().items.some((x) => x.status === "unread" || x.status === "failed")) return [];
  return updateNotices((n) => {
    const settled: number[] = [];
    for (const x of n.items) {
      if (x.status !== "unread" && x.status !== "failed") continue;
      const why = handledWhy(x, ctx);
      if (!why) continue;
      x.status = "done";
      x.handled = why;
      x.readAt = now.toISOString();
      delete x.error;
      settled.push(x.event);
    }
    return settled;
  });
}

// 还没看的通知里链着的 PR：每轮查 links 时一起查，认出你已经 approve / 合了的。
export function noticePrKeys(): string[] {
  return [...new Set(loadNotices().items.filter((x) => x.status === "unread" || x.status === "failed").flatMap((x) => keysOf(x.text).filter((k) => k.includes("/pull/"))))];
}
