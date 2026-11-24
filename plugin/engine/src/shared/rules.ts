// 规矩里的几样东西给人看的名字、默认值，和面板、引擎都要算的几件事（回复放哪、判断归哪类）。
// 纯 TypeScript，面板也 import（见 sources.ts 开头）。
import type { Audience, Decision, Expect, Handle, Placement, ReplyMode } from "./types";

export const HANDLE_LABELS: Readonly<Record<Handle, string>> = {
  dispatch: "派人去办", note: "只记下", ignore: "忽略", approve: "直接 approve PR", command: "当成我的指令",
};

// chief rules 里的说法（长）和面板下拉里的说法（短）。
export const REPLY_MODE_LABELS: Readonly<Record<ReplyMode, string>> = { ask: "回复先给我确认", auto: "回复直接发（发前 5 秒可撤回）" };
export const REPLY_MODE_SHORT: Readonly<Record<ReplyMode, string>> = { ask: "对外先问我", auto: "对外直接发" };

export const EXPECT_LABELS: Readonly<Record<Expect, string>> = { dispatch: "派人去办", note: "只记下", ignore: "忽略", ask: "问你" };

export const AUDIENCE_LABELS: Readonly<Record<Audience, string>> = { direct: "一对一私信", group: "群聊", channel: "频道", self: "你给自己发的" };

export const DEFAULT_PLACEMENT: Readonly<Record<Audience, Placement>> = { direct: "inline", group: "inline", channel: "thread", self: "thread" };

export const DEFAULT_SIGNATURE = "🤖 agent reply";

// 一条 Slack 回复最终放哪：对方在 thread 里 → 回 thread；稿子自己指定了（target.in）→ 照它；否则按规矩里这种对话的默认。
export function placementOf(target: Readonly<Record<string, string>>, placement: Readonly<Record<Audience, Placement>>): Placement {
  if (target.thread_ts) return "thread";
  if (target.in === "thread" || target.in === "inline") return target.in;
  const audience = (target.audience as Audience | undefined) ?? (target.channel?.startsWith("D") ? "direct" : "channel");
  return placement[audience] ?? "thread";
}

export function expectOf(verdict: Decision["verdict"]): Expect {
  return verdict === "forwarded" || verdict === "opened" ? "dispatch" : verdict === "asked" ? "ask" : verdict === "ignored" ? "ignore" : "note";
}

// engine.json 的 health 里，数据文件坏了的那一项用这个名字（不是来源）。
export const DATA_HEALTH = "数据文件";
