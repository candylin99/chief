// 事情的阶段：需求做到哪一步了。引擎（chief thing 记阶段、links.ts 查 Jira）和面板共用这一份。纯 TypeScript，面板也 import。
// 七个阶段一条线：计划中 → 方案中 → 开发中 → 用例评审中 → 测试中 → 待发布 → 已上线。「暂停」「卡住」不是阶段，是叠在阶段旁边的标记。
// 阶段从哪来，依次取第一个有的（见 stageOf）：关联的 Jira 需求的状态；会话汇报的（只在 Jira 还是计划中时用，补上方案中、用例评审中）；
// 没有 Jira 时看 PR（有开着的算开发中，全合了算待发布）。

export const STAGES = ["plan", "design", "dev", "casereview", "testing", "ready", "live"] as const;
export type Stage = (typeof STAGES)[number];

// 汇报时也能写「暂停」：存成 hold，面板画成标记，不当阶段。
export type Reported = Stage | "hold";

export const STAGE_LABELS: Readonly<Record<"zh" | "en", Record<Reported, string>>> = {
  zh: { plan: "计划中", design: "方案中", dev: "开发中", casereview: "用例评审中", testing: "测试中", ready: "待发布", live: "已上线", hold: "暂停" },
  en: { plan: "Planned", design: "Design", dev: "In dev", casereview: "Case review", testing: "Testing", ready: "Ready", live: "Live", hold: "Paused" },
};

// 面板按它挑颜色：还没动、在做、在测、快好了、好了。
export const STAGE_TONE: Readonly<Record<Stage, "idle" | "build" | "qa" | "ship" | "done">> = {
  plan: "idle", design: "build", dev: "build", casereview: "qa", testing: "qa", ready: "ship", live: "done",
};

// 汇报里写的阶段：认英文的 id、中文名、几种常见说法（去掉空格、不分大小写比），也认旧版存下的 id。认不出是 null。
const ALIASES: Readonly<Record<string, Reported>> = {
  计划中: "plan", 计划: "plan", 待开始: "plan", 未开始: "plan", 排期中: "plan", todo: "plan",
  方案中: "design", 方案: "design", 技术方案: "design", 设计中: "design",
  开发中: "dev", 开发: "dev", 联调: "dev", 联调中: "dev",
  用例评审中: "casereview", 用例评审: "casereview", 评审用例中: "casereview", 评审用例: "casereview", qa用例评审: "casereview", qa用例评审中: "casereview",
  测试中: "testing", 测试: "testing", 提测: "testing", 已提测: "testing", 回归: "testing", 验收: "testing", 验收中: "testing", handoff: "testing", acceptance: "testing",
  待发布: "ready", 待上线: "ready",
  已上线: "live", 上线: "live", 已发布: "live", 线上验证: "live", 灰度: "live", 灰度中: "live", 完成: "live", 已完成: "live", released: "live", prodcheck: "live", done: "live",
  暂停: "hold", 搁置: "hold", hold: "hold",
};

export function parseStage(text: string): Reported | null {
  const k = text.replace(/\s+/g, "").toLowerCase();
  if ((STAGES as readonly string[]).includes(k)) return k as Stage;
  return ALIASES[k] ?? null;
}

// Jira 状态 → 阶段；ON HOLD 是 hold（标记）。先按名字认（RTC 的工作流和几种常见写法），认不出按状态大类：没开始是计划中，完成是已上线，进行中不知道哪一步（null）。
// 顺序要紧：「Test In Progress」先认成测试中、「Test In Production」先认成已上线，别被「in progress」「test」截走。
const JIRA: readonly [RegExp, Reported][] = [
  [/^(open|to ?do|backlog|new|selected for development)$/i, "plan"],
  [/^(on ?hold|blocked|paused)$/i, "hold"],
  [/test(ing)? in prod(uction)?|prod(uction)? (check|verif)/i, "live"],
  [/design|spec|方案/i, "design"],
  [/case ?review|用例/i, "casereview"],
  [/ready (for|to) (test|qa)|提测/i, "testing"],
  [/test|\bqa\b|regression|acceptance|\buat\b|测试|验收/i, "testing"],
  [/ready (to|for) (deploy|release)|待发布/i, "ready"],
  [/^(released|deployed|已发布)$/i, "live"],
  [/under development|in development|in progress|developing|code review|in review|开发/i, "dev"],
  [/^(closed|done|resolved|cancel+ed|won'?t (do|fix))$/i, "live"],
];

export function jiraStage(status: string, category: string | null = null): Reported | null {
  for (const [re, s] of JIRA) if (re.test(status.trim())) return s;
  if (category === "new") return "plan";
  if (category === "done") return "live";
  return null;
}

// PR 推断：没有 Jira 时，有开着的 PR 算开发中，PR 都合了算待发布，都关了不算。
export function prStage(prs: readonly { state: "open" | "merged" | "closed" }[]): Stage | null {
  if (prs.some((p) => p.state === "open")) return "dev";
  if (prs.length > 0 && prs.every((p) => p.state !== "open") && prs.some((p) => p.state === "merged")) return "ready";
  return null;
}

// 面板显示哪个阶段、要不要叠「暂停」：
// 有 Jira：按 Jira；Jira 还是计划中、汇报写了更细的（方案中、用例评审中……）用汇报的。没有 Jira：汇报的，再没有看 PR。
// Jira 是 ON HOLD 或汇报写了暂停：paused，阶段照上面的规则另取。
export function stageOf(jira: Reported | null, reported: Reported | null, pr: Stage | null = null): { stage: Stage | null; paused: boolean } {
  const paused = jira === "hold" || reported === "hold";
  const j = jira === "hold" ? null : jira;
  const r = reported === "hold" ? null : reported;
  if (j !== null) return { stage: j === "plan" && r !== null ? r : j, paused };
  return { stage: r ?? pr, paused };
}

// 文字里的 Jira 单号（标题写了单号、却没挂成键的事情，面板和引擎都按它补上）。
const TICKET = /\b([A-Z][A-Z0-9]{1,9}-\d{1,7})\b/g;
const NOT_TICKETS = new Set(["UTF", "ISO", "SHA", "RFC", "HTTP", "TLS", "SSL", "MD", "GPT", "CVE", "ES", "IE", "COVID"]);

export function ticketKeysIn(text: string): string[] {
  return [...new Set([...text.matchAll(TICKET)].map((m) => m[1]!).filter((k) => !NOT_TICKETS.has(k.split("-")[0]!)))];
}
