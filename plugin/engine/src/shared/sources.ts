// 来源的名单：每个来源叫什么、带来哪几种场景（规矩按场景定）、设置页怎么连。引擎和面板都从这里拿。
// shared/ 里的文件面板也 import（插件运行时里没有 Node）：只许纯 TypeScript，不 import node 的东西、不 import shared/ 以外的文件。
// 加一个来源：这里加一项，再在 sources/ 里写它的 SourceDescriptor、放进 sources/registry.ts（见 ARCHITECTURE.md「加一个来源」）。
import type { Handle, ReplyMode } from "./types";

// 场景的默认做法：handle 怎么办，reply 回复要不要你确认（默认 ask），brief 派活时交代的话。
export interface ScenarioMeta {
  label: string;
  // 英文界面里的名字（config.json 的 locale 是 en 时用，见 i18n.ts）。
  en: string;
  handle: Handle;
  reply?: ReplyMode;
  brief?: string;
}

// 设置页怎么连：
//   browser：开浏览器窗口让你登录，拿到的东西存进钥匙串（Slack）；
//   cli：用本机已经登录的命令（gh、acli），install / login 是没装、没登录时告诉你在终端跑什么；
//   secret：令牌从标准输入给（pbpaste | chief connect <来源>），存进钥匙串。
export type SetupMeta = { kind: "browser" } | { kind: "cli"; install: string; login: string } | { kind: "secret" };

export interface SourceMeta {
  label: string;
  // push：来源自己推过来（Slack，见 slack/plugin.ts）；poll：引擎每隔几分钟去拉（sources/）。
  mode: "push" | "poll";
  // 场景：键是事件的 why（拼成「来源_why」就是场景名），顺序就是策略页、chief rules 里的顺序。
  scenarios: Readonly<Record<string, ScenarioMeta>>;
  setup: SetupMeta;
  // 钥匙串里存的是什么（chief status 里说「Slack Cookie 有 / 没有」）。
  secretLabel?: string;
  // 只读的来源：回复发不出去，说一句为什么。
  readOnly?: string;
}

export const SOURCE_META = {
  slack: {
    label: "Slack",
    mode: "push",
    scenarios: {
      self: { label: "我在 Slack 上给自己发的话", en: "Messages I send myself on Slack", handle: "command", reply: "auto" },
      dm: { label: "Slack 私信", en: "Slack DMs", handle: "dispatch" },
      mention: { label: "Slack 频道里 @我", en: "@me in a Slack channel", handle: "dispatch" },
      thread: { label: "我在的 Slack thread 有后续", en: "Follow-ups in Slack threads I'm in", handle: "note" },
    },
    setup: { kind: "browser" },
    secretLabel: "Cookie",
  },
  github: {
    label: "GitHub",
    mode: "poll",
    scenarios: {
      review: { label: "PR 请我 review", en: "PR review requested from me", handle: "dispatch" },
      mention: { label: "GitHub 上 @我", en: "@me on GitHub", handle: "dispatch" },
      comment: { label: "别人评论了我的 PR / issue", en: "Comments on my PR / issue", handle: "dispatch" },
      assigned: { label: "GitHub 指派给我", en: "Assigned to me on GitHub", handle: "dispatch" },
      approved: { label: "我的 PR 被 approve 了", en: "My PR was approved", handle: "dispatch", brief: "看 CI 过没过、还有没有没回的评论；能合就问我要不要合，别自己合" },
      changes: { label: "我的 PR 被要求修改", en: "Changes requested on my PR", handle: "dispatch" },
    },
    setup: { kind: "cli", install: "brew install gh", login: "gh auth login" },
  },
  jira: {
    label: "Jira",
    mode: "poll",
    scenarios: {
      assigned: { label: "Jira 指派给我", en: "Assigned to me on Jira", handle: "dispatch" },
      mention: { label: "Jira 评论里提到我", en: "Mentioned in a Jira comment", handle: "dispatch" },
      comment: { label: "别人评论了我的 Jira 单", en: "Comments on my Jira issue", handle: "note" },
    },
    setup: { kind: "cli", install: "brew install acli", login: "acli jira auth login --web（用 twg 的话：twg login）" },
  },
  notion: {
    label: "Notion",
    mode: "poll",
    scenarios: {
      comment: { label: "Notion 页面有新评论", en: "New comment on a Notion page", handle: "note" },
    },
    setup: { kind: "secret" },
    secretLabel: "令牌",
    readOnly: "Notion 集成只读",
  },
} as const satisfies Record<string, SourceMeta>;

export type SourceId = keyof typeof SOURCE_META;
// session：事情挂着的 Claude App 会话有了新进展（引擎看会话记录发现的），不是外部来源。
// chief：引擎自己交的（每天汇总到点了）。
export type EventSource = SourceId | "session" | "chief";

export const SOURCE_IDS = Object.keys(SOURCE_META) as SourceId[];

export function isSourceId(text: string): text is SourceId {
  return Object.hasOwn(SOURCE_META, text);
}

export const SOURCE_LABELS: Readonly<Record<EventSource, string>> = {
  ...(Object.fromEntries(SOURCE_IDS.map((id) => [id, SOURCE_META[id].label])) as Record<SourceId, string>),
  session: "会话",
  chief: "chief",
};

// 面板里的来源名（认不出的原样显示：引擎比面板新时可能有面板不认得的来源）。
export function sourceLabel(id: string): string {
  return (SOURCE_LABELS as Record<string, string>)[id] ?? id;
}

// 不属于哪个来源的场景，排在最后。
const EXTRA_SCENARIOS = {
  session_update: { label: "我的会话有新进展", en: "My session has an update", handle: "note" },
  other: { label: "其他", en: "Other", handle: "note" },
} as const satisfies Record<string, ScenarioMeta>;

type Meta = typeof SOURCE_META;
// 一条消息属于哪个场景：「来源_why」，加上会话进展和其他。从上面的名单推出来，加了来源这里自己就有。
export type Scenario = { [K in SourceId]: `${K}_${keyof Meta[K]["scenarios"] & string}` }[SourceId] | keyof typeof EXTRA_SCENARIOS;

export const SCENARIO_META: Readonly<Record<Scenario, ScenarioMeta>> = Object.fromEntries([
  ...SOURCE_IDS.flatMap((id) => Object.entries(SOURCE_META[id].scenarios as Record<string, ScenarioMeta>).map(([why, m]) => [`${id}_${why}`, m] as const)),
  ...Object.entries(EXTRA_SCENARIOS),
]) as Record<Scenario, ScenarioMeta>;

// 场景名 → 给人看的一句。
export const SCENARIOS: Readonly<Record<Scenario, string>> = Object.fromEntries(Object.entries(SCENARIO_META).map(([k, m]) => [k, m.label])) as Record<Scenario, string>;

export function isScenario(text: string): text is Scenario {
  return Object.hasOwn(SCENARIO_META, text);
}

export function scenarioOf(e: { source: EventSource; why: readonly string[] }): Scenario {
  if (e.source === "session") return "session_update";
  if (e.source === "chief") return "other";
  const s = `${e.source}_${e.why[0] ?? ""}`;
  return isScenario(s) ? s : "other";
}
