// 界面语言：config.json 的 locale（"zh" 默认、"en"）。引擎的通知（src/messages.ts）和面板（hooks/i18n.ts）各有一本字典，
// 两边都用的名字（场景、做法、来源……）在这里。纯 TypeScript，面板也 import（见 sources.ts 开头）。
// 字典的 en 照 zh 的类型写：少了哪一项 tsc 就报错。
import { AUDIENCE_LABELS, EXPECT_LABELS, HANDLE_LABELS, REPLY_MODE_LABELS, REPLY_MODE_SHORT } from "./rules";
import { SCENARIO_META, SCENARIOS, SOURCE_LABELS, type EventSource, type Scenario } from "./sources";
import type { Audience, Decision, Expect, Handle, ReplyMode } from "./types";

export type Locale = "zh" | "en";
export const LOCALES: readonly Locale[] = ["zh", "en"];

// 认不出的一律按中文。
export function localeOf(v: unknown): Locale {
  return v === "en" ? "en" : "zh";
}

export interface SharedLabels {
  handle: Readonly<Record<Handle, string>>;
  replyMode: Readonly<Record<ReplyMode, string>>;
  replyModeShort: Readonly<Record<ReplyMode, string>>;
  expect: Readonly<Record<Expect, string>>;
  audience: Readonly<Record<Audience, string>>;
  verdict: Readonly<Record<Decision["verdict"], string>>;
  scenario: Readonly<Record<Scenario, string>>;
  source: Readonly<Record<EventSource, string>>;
}

const zh: SharedLabels = {
  handle: HANDLE_LABELS,
  replyMode: REPLY_MODE_LABELS,
  replyModeShort: REPLY_MODE_SHORT,
  expect: EXPECT_LABELS,
  audience: AUDIENCE_LABELS,
  verdict: { forwarded: "送进会话", opened: "开了新会话", asked: "问你", noted: "只记下", ignored: "忽略" },
  scenario: SCENARIOS,
  source: SOURCE_LABELS,
};

const en: SharedLabels = {
  handle: { dispatch: "Hand off", note: "Just note it", ignore: "Ignore", approve: "Approve the PR", command: "Treat as my instruction" },
  replyMode: { ask: "Ask me before replying", auto: "Send replies directly (5 s to undo)" },
  replyModeShort: { ask: "Ask me first", auto: "Send directly" },
  expect: { dispatch: "Hand off", note: "Just note it", ignore: "Ignore", ask: "Ask you" },
  audience: { direct: "1:1 DM", group: "Group DM", channel: "Channel", self: "Notes to yourself" },
  verdict: { forwarded: "Sent to session", opened: "Opened a session", asked: "Asked you", noted: "Noted", ignored: "Ignored" },
  scenario: Object.fromEntries(Object.entries(SCENARIO_META).map(([k, m]) => [k, m.en])) as Record<Scenario, string>,
  source: { ...SOURCE_LABELS, session: "Session" },
};

export const LABELS: Readonly<Record<Locale, SharedLabels>> = { zh, en };

export function labels(locale: Locale): SharedLabels {
  return LABELS[locale];
}

// 来源名（认不出的原样显示）。
export function sourceLabelIn(locale: Locale, id: string): string {
  return (LABELS[locale].source as Record<string, string>)[id] ?? id;
}
