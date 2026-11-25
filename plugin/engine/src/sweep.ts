// 过时清扫：每轮查完单子和 PR（links.ts）顺带看一遍待办，过时的收起来或提醒，不替用户对外做任何事。
//   1. approve 卡（等你点的、没发出去的）：PR 已合并 / 已关闭 / 你自己已经 approve 过 → 收起（status 改成 dropped，记下 stale：为什么、原来是什么状态），
//      面板留一行灰字和「不对，恢复」（chief reply unstale R）。恢复过的记 staleIgnored，以后不再收。
//   2. 待发出的 Slack 回复：卡片生成之后，你本人在那个 thread / 私信里说过话 → 卡上标 selfReplied（「你可能已经亲自回过」），不收、不发。
//      规矩允许直接发、正在排队的那种，发之前也查这一下（engine.ts 的 sendDue），查到就放回待确认。
//   3. 要你定的问题：问题挂的那件事的 PR 合了 / 关了、Jira 做完了（或问题里提到的那张）→ 交给主会话一条 ask.stale 事件，它判断撤不撤。
//   「可以收尾」（关联的 PR 全合了、Jira 全做完了）只在面板上算，见 hooks/tags.tsx。
import { githubKey, keysOf } from "./keys";
import { jiraStage, ticketKeysIn } from "./shared/stage";
import type { Ask, ChiefEvent, LinksFile, Reply, Thing } from "./shared/types";

// 你在 Slack 上最近一次自己说话的时间：对话的键（slack:<频道>:<thread 根> 或私信的 slack:<频道>:dm）→ 时间。
export type Spoke = Record<string, string>;

const REF = /^([\w.-]{1,100})\/([\w.-]{1,100})#(\d{1,9})$/;

// approve 回复的 target.ref（Owner/repo#123）→ PR 的键（github.com/owner/repo/pull/123，和 links.json 一样）。
export function prKeyOfRef(ref: string | undefined): string | null {
  const m = REF.exec((ref ?? "").trim());
  return m ? githubKey(m[1]!, m[2]!, "pull", m[3]!) : null;
}

// approve 卡该不该收：PR 合了、关了、你自己 approve 过。
export function approveStale(r: Reply, links: LinksFile): "merged" | "closed" | "approved" | null {
  if (r.kind !== "approve" || (r.status !== "pending" && r.status !== "failed") || r.staleIgnored) return null;
  const key = prKeyOfRef(r.target.ref);
  const pr = key ? links.prs[key] : undefined;
  if (!pr) return null;
  if (pr.state === "merged") return "merged";
  if (pr.state === "closed") return "closed";
  return pr.approvedByMe ? "approved" : null;
}

// 回复卡生成之后你本人在那段对话里说过话没有：说过就返回最近那次的时间。看收到的那条消息所在的对话，和以它为根的 thread。
export function spokeAfter(r: Reply, event: ChiefEvent | null, spoke: Spoke): string | null {
  if (r.source !== "slack" || r.kind === "approve" || r.kind === "message") return null;
  const ch = r.target.channel;
  const keys = new Set<string>();
  if (event?.keys[0]?.startsWith("slack:")) keys.add(event.keys[0]);
  if (ch && (r.target.thread_ts || r.target.ts)) keys.add(`slack:${ch}:${r.target.thread_ts ?? r.target.ts}`);
  let latest: string | null = null;
  for (const k of keys) {
    const at = spoke[k];
    if (at && at > r.at && (latest === null || at > latest)) latest = at;
  }
  return latest;
}

// 清扫一遍回复（就地改）：返回收起了哪些、标了哪些。重复跑结果一样（收过的、标过同一时间的不再动）。
export function sweepReplies(replies: Reply[], links: LinksFile, eventOf: (id: number) => ChiefEvent | null, spoke: Spoke, now = new Date()): { closed: Reply[]; flagged: Reply[] } {
  const closed: Reply[] = [];
  const flagged: Reply[] = [];
  for (const r of replies) {
    const why = approveStale(r, links);
    if (why) {
      r.stale = { why, at: now.toISOString(), was: r.status as "pending" | "failed" };
      r.status = "dropped";
      closed.push(r);
      continue;
    }
    if (r.status !== "pending" && r.status !== "failed") continue;
    const at = spokeAfter(r, eventOf(r.event), spoke);
    if (at && r.selfReplied?.at !== at) {
      r.selfReplied = { at };
      flagged.push(r);
    }
  }
  return { closed, flagged };
}

// 「不对，恢复」：放回原来的状态，以后不再自动收。
export function unstale(r: Reply): void {
  if (!r.stale) return;
  r.status = r.stale.was;
  delete r.stale;
  r.staleIgnored = true;
}

// 开着的问题，挂的东西已经办完了：问题那件事的 PR 合了 / 关了、Jira 做完了，或问题、建议里提到的 PR / 单号办完了。
// 每个（问题、键）一条；主会话判断撤不撤。去重由引擎发事件时按「askstale:问题:键」做。
export function staleAsks(things: readonly Thing[], asks: readonly Ask[], links: LinksFile): { ask: Ask; thing: Thing; key: string; what: string }[] {
  const out: { ask: Ask; thing: Thing; key: string; what: string }[] = [];
  for (const a of asks) {
    if (a.status !== "open") continue;
    const t = things.find((x) => x.id === a.thing);
    if (!t || t.status === "done" || t.status === "dropped") continue;
    const text = `${a.question} ${a.suggest}`;
    const keys = new Set([...(t.keys ?? []), ...keysOf(text), ...ticketKeysIn(text)]);
    for (const key of keys) {
      const pr = links.prs[key];
      if (pr && pr.state !== "open") {
        out.push({ ask: a, thing: t, key, what: `PR ${pr.ref}（${pr.title}）${pr.state === "merged" ? "已合并" : "已关闭"}` });
        continue;
      }
      const j = links.jira[key];
      if (j && (j.category === "done" || jiraStage(j.status, j.category) === "live")) {
        out.push({ ask: a, thing: t, key, what: `Jira ${j.key}（${j.title}）现在是 ${j.status}` });
      }
    }
  }
  return out;
}

// 交给主会话的那条事件。
export function askStaleEvent(x: { ask: Ask; thing: Thing; key: string; what: string }, now: Date): Omit<ChiefEvent, "id"> {
  return {
    at: now.toISOString(), source: "chief", kind: "ask.stale", title: `问题可能过时了：${x.thing.title}`.slice(0, 200), url: null, from: null,
    text: `事情 #${x.thing.id}「${x.thing.title}」还开着问题 #${x.ask.id}「${x.ask.question.slice(0, 200)}」，但它挂的 ${x.what}。用 chief ask show ${x.ask.id} 看问题，判断还成不成立：不成立了就 chief ask withdraw ${x.ask.id}（标准输入写为什么），还成立就留着。这条 mark noted --thing ${x.thing.id}。`,
    why: ["stale"], keys: [x.key, ...(x.thing.session ? [x.thing.session] : [])], reply: {},
  };
}
