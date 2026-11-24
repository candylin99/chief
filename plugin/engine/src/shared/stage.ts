// 事情的阶段：需求做到哪一步了。引擎（chief thing 记阶段、links.ts 查 Jira）和面板共用这一份。纯 TypeScript，面板也 import。
// 阶段有两个来处：关联的 Jira 需求的状态（jiraStage 换算），和工作会话 / 主会话汇报时写的（事情的 stage）。
// Jira 上「方案」「用例评审」都还是 OPEN、和开发并行，所以 Jira 说待开始 / 开发中时，汇报的阶段更细，用汇报的（见 stageOf）。

export const STAGES = ["todo", "design", "dev", "handoff", "casereview", "testing", "acceptance", "ready", "prodcheck", "released", "hold", "done"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Readonly<Record<"zh" | "en", Record<Stage, string>>> = {
  zh: {
    todo: "待开始", design: "方案中", dev: "开发中", handoff: "提测", casereview: "QA 用例评审", testing: "测试中",
    acceptance: "验收中", ready: "待发布", prodcheck: "线上验证", released: "已发布", hold: "暂停", done: "完成",
  },
  en: {
    todo: "To do", design: "Design", dev: "In dev", handoff: "Handed to QA", casereview: "Case review", testing: "Testing",
    acceptance: "Acceptance", ready: "Ready to deploy", prodcheck: "Prod check", released: "Released", hold: "On hold", done: "Done",
  },
};

// 颜色的档：面板按它挑颜色（淡、进行中、要留意、快好了、好了）。
export const STAGE_TONE: Readonly<Record<Stage, "dim" | "active" | "qa" | "ship" | "done">> = {
  todo: "dim", hold: "dim", design: "active", dev: "active", handoff: "qa", casereview: "qa", testing: "qa", acceptance: "qa",
  ready: "ship", prodcheck: "ship", released: "done", done: "done",
};

// 汇报里写的阶段：认英文的 id，也认中文的名字和几种常见说法（去掉空格比）。认不出是 null。
const ALIASES: Readonly<Record<string, Stage>> = {
  待开始: "todo", 未开始: "todo", 方案: "design", 方案中: "design", 技术方案: "design", 设计中: "design", 开发: "dev", 开发中: "dev", 联调: "dev", 联调中: "dev",
  提测: "handoff", 已提测: "handoff", 用例评审: "casereview", qa用例评审: "casereview", 用例评审中: "casereview", 测试: "testing", 测试中: "testing", 回归: "testing",
  验收: "acceptance", 验收中: "acceptance", 待发布: "ready", 待上线: "ready", 线上验证: "prodcheck", 灰度: "prodcheck", 灰度中: "prodcheck",
  已发布: "released", 已上线: "released", 暂停: "hold", 搁置: "hold", 完成: "done", 已完成: "done",
};

export function parseStage(text: string): Stage | null {
  const k = text.replace(/\s+/g, "").toLowerCase();
  if ((STAGES as readonly string[]).includes(k)) return k as Stage;
  return ALIASES[k] ?? null;
}

// Jira 状态 → 阶段。先按名字认（RTC 的工作流和几种常见写法），认不出按状态大类（statusCategory）：没开始、进行中（不知道哪一步，返回 null）、完成。
// 顺序要紧：「Test In Progress」先认成测试、「Test In Production」先认成线上验证，别被「in progress」「test」截走。
const JIRA: readonly [RegExp, Stage][] = [
  [/^(open|to ?do|backlog|new|selected for development)$/i, "todo"],
  [/^(on ?hold|blocked|paused)$/i, "hold"],
  [/test(ing)? in prod(uction)?|prod(uction)? (check|verif)/i, "prodcheck"],
  [/design|spec|方案/i, "design"],
  [/case ?review|用例/i, "casereview"],
  [/ready (for|to) (test|qa)|提测/i, "handoff"],
  [/test|\bqa\b|regression|测试/i, "testing"],
  [/acceptance|\buat\b|验收/i, "acceptance"],
  [/ready (to|for) (deploy|release)|待发布/i, "ready"],
  [/^(released|deployed|已发布)$/i, "released"],
  [/under development|in development|in progress|developing|code review|in review|开发/i, "dev"],
  [/^(closed|done|resolved|cancel+ed|won'?t (do|fix))$/i, "done"],
];

export function jiraStage(status: string, category: string | null = null): Stage | null {
  for (const [re, s] of JIRA) if (re.test(status.trim())) return s;
  if (category === "new") return "todo";
  if (category === "done") return "done";
  return null;
}

// 面板上显示哪个阶段：有 Jira 的按 Jira；Jira 还在待开始 / 开发中、汇报里写了更细的，用汇报的；没有 Jira 用汇报的。
export function stageOf(jira: Stage | null, reported: Stage | null): Stage | null {
  if (jira === null) return reported;
  if (reported !== null && (jira === "todo" || jira === "dev")) return reported;
  return jira;
}
