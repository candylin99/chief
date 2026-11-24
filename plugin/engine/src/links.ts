// 事情关联的东西现在怎样：Jira 单（和它的父需求）是什么状态、PR 开着还是合了、review 和 CI 过没过，这件事最早是从哪条消息来的。
// 引擎每 10 分钟查一次（只查没办完的事情），写进 links.json，面板读它画标签和阶段。只读：Jira 只搜和看，GitHub 只看 PR。
// 查询里只放认得出的工单号和 PR 地址（先过正则），不拼别的字。
import type { JiraCli } from "./sources/jira";
import type { GhRunner } from "./sources/github";
import type { ChiefEvent, JiraLink, LinksFile, OriginLink, PrLink, Reply, Thing } from "./shared/types";

const JIRA_KEY = /^[A-Z][A-Z0-9]{1,9}-\d{1,7}$/;
const PR_KEY = /^github\.com\/([\w.-]{1,100})\/([\w.-]{1,100})\/pull\/(\d{1,9})$/;
const SLACK_KEY = /^slack:([CDG][A-Z0-9]{2,20}):(\d{9,11}\.\d{1,6})$/;
const NOTION_KEY = /^notion:([0-9a-f]{32})$/;
const WORKSPACE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const SITE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
// 一轮最多查多少：事情多了也不至于把 Jira / GitHub 打爆。
const MAX_JIRA = 80;
const MAX_PRS = 40;
const BATCH = 40;
// 交过来的消息里，这几种是 chief 自己补交、提醒的，不算「从哪来」。
const NOT_ORIGIN = new Set(["chief.missed", "thing.woke", "digest"]);

export const EMPTY_LINKS: LinksFile = { at: null, jira: {}, prs: {}, origins: {}, messages: {}, errors: {} };

export function jiraKeysIn(keys: readonly string[]): string[] {
  return keys.filter((k) => JIRA_KEY.test(k));
}

export function prKeysIn(keys: readonly string[]): string[] {
  return keys.filter((k) => PR_KEY.test(k));
}

export function prUrl(key: string): string | null {
  const m = PR_KEY.exec(key);
  return m ? `https://github.com/${m[1]}/${m[2]}/pull/${m[3]}` : null;
}

// Slack 消息的链接：工作区子域名、频道、消息时间戳都认得出才拼。在 thread 里的带上 thread_ts，点开直接落到那条回复上。
export function slackPermalink(workspace: string | null, channel: string, ts: string, threadTs?: string): string | null {
  if (!workspace || !WORKSPACE.test(workspace) || !/^[CDG][A-Z0-9]{2,20}$/.test(channel) || !/^\d{9,11}\.\d{1,6}$/.test(ts)) return null;
  const base = `https://${workspace}.slack.com/archives/${channel}/p${ts.replace(".", "")}`;
  return threadTs && threadTs !== ts && /^\d{9,11}\.\d{1,6}$/.test(threadTs) ? `${base}?thread_ts=${threadTs}&cid=${channel}` : base;
}

// 一条消息能点开的地址：外部来源自己带着；Slack 拼出来；会话、chief 自己的没有。
export function messageUrl(e: ChiefEvent, workspace: string | null): string | null {
  if (e.url && /^https:\/\//.test(e.url)) return e.url;
  if (e.source === "slack" && e.reply.channel && e.reply.ts) return slackPermalink(workspace, e.reply.channel, e.reply.ts, e.reply.thread_ts);
  return null;
}

const one = (s: string, max: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
};

// 一件事从哪来：它最早的那条消息（chief 自己补交的提醒不算）；没有消息的（导入的）看它的键。
export function originOf(t: Thing, eventOf: (id: number) => ChiefEvent | null, workspace: string | null, site: string | null): OriginLink | null {
  for (const id of [...t.events].sort((a, b) => a - b)) {
    const e = eventOf(id);
    if (!e || NOT_ORIGIN.has(e.kind)) continue;
    // Slack 的标题是对话的名字（#频道、私信的人）；你给自己发的那种写成「我自己」。
    const label = e.source === "slack" && e.why.includes("self") ? "我自己" : one(e.title, e.source === "slack" || e.source === "session" ? 30 : 40);
    return { source: e.source, label, url: messageUrl(e, workspace) };
  }
  for (const k of t.keys ?? []) {
    const s = SLACK_KEY.exec(k);
    if (s) return { source: "slack", label: "Slack", url: slackPermalink(workspace, s[1]!, s[2]!) };
  }
  for (const k of t.keys ?? []) {
    if (JIRA_KEY.test(k)) return { source: "jira", label: k, url: site && SITE.test(site) ? `https://${site}/browse/${k}` : null };
    const pr = prUrl(k);
    if (pr) return { source: "github", label: k.replace(/^github\.com\/[^/]+\//, "").replace("/pull/", "#"), url: pr };
    const n = NOTION_KEY.exec(k);
    if (n) return { source: "notion", label: "Notion", url: `https://www.notion.so/${n[1]}` };
  }
  return null;
}

// —— GitHub：gh pr view 的结果 → PR 的样子 ——

interface Rollup { __typename?: string; status?: string; conclusion?: string | null; state?: string }
interface GhPr { number?: number; title?: string; state?: string; isDraft?: boolean; reviewDecision?: string | null; statusCheckRollup?: Rollup[] | null; url?: string }

const BAD = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"]);

// CI：有一个挂了就是挂了；还有在跑的就是在跑；都过了（含跳过、中性）是过了；没有检查是 null。
export function ciOf(rollup: readonly Rollup[] | null | undefined): PrLink["ci"] {
  const all = rollup ?? [];
  if (all.length === 0) return null;
  if (all.some((r) => BAD.has(String(r.conclusion ?? r.state ?? "").toUpperCase()))) return "fail";
  if (all.some((r) => (r.__typename === "StatusContext" ? /^(PENDING|EXPECTED)$/i.test(r.state ?? "") : String(r.status ?? "").toUpperCase() !== "COMPLETED"))) return "pending";
  return "pass";
}

export function prOf(key: string, raw: GhPr): PrLink {
  const state = String(raw.state ?? "").toUpperCase();
  const review = String(raw.reviewDecision ?? "").toUpperCase();
  return {
    ref: key.replace(/^github\.com\//, "").replace("/pull/", "#"),
    url: prUrl(key) ?? "",
    title: one(raw.title ?? "", 120),
    state: state === "MERGED" ? "merged" : state === "CLOSED" ? "closed" : "open",
    draft: raw.isDraft === true,
    review: review === "APPROVED" ? "approved" : review === "CHANGES_REQUESTED" ? "changes" : review === "REVIEW_REQUIRED" ? "required" : null,
    ci: state === "OPEN" ? ciOf(raw.statusCheckRollup) : null,
  };
}

// —— Jira：搜出来的单子 → 单子的样子 ——

interface JiraIssue {
  key: string;
  fields: { summary?: string; status?: { name?: string; statusCategory?: { key?: string } }; issuetype?: { name?: string }; parent?: { key?: string } | null };
}

export function jiraOf(it: JiraIssue, site: string): JiraLink {
  const parent = it.fields.parent?.key;
  return {
    key: it.key, title: one(it.fields.summary ?? "", 120), status: it.fields.status?.name ?? "?",
    category: it.fields.status?.statusCategory?.key ?? null, type: it.fields.issuetype?.name ?? null,
    ...(parent && JIRA_KEY.test(parent) ? { parent } : {}), url: `https://${site}/browse/${it.key}`,
  };
}

const FIELDS = "key,summary,status,issuetype,parent";

// 一批一批搜；某一批搜不成（里面有删掉的单之类）就一张张看，看不到的跳过。没登录照样往外抛，这一轮算 Jira 查不成。
async function fetchJira(cli: JiraCli, site: string, keys: readonly string[], signal: AbortSignal): Promise<Record<string, JiraLink>> {
  const out: Record<string, JiraLink> = {};
  for (let i = 0; i < keys.length; i += BATCH) {
    const batch = keys.slice(i, i + BATCH);
    try {
      for (const it of (await cli.search(`key in (${batch.join(",")})`, FIELDS, batch.length, signal)) as JiraIssue[]) {
        if (JIRA_KEY.test(it.key)) out[it.key] = jiraOf(it, site);
      }
    } catch (error) {
      if (signal.aborted || /没登录|login/i.test(error instanceof Error ? error.message : "")) throw error;
      for (const k of batch) {
        try {
          const it = (await cli.view(k, FIELDS, signal)) as JiraIssue;
          if (JIRA_KEY.test(it.key)) out[it.key] = jiraOf(it, site);
        } catch (e) {
          if (signal.aborted) throw e;
        }
      }
    }
  }
  return out;
}

async function fetchPrs(gh: GhRunner, keys: readonly string[], signal: AbortSignal): Promise<Record<string, PrLink>> {
  const out: Record<string, PrLink> = {};
  let failed: unknown = null;
  for (let i = 0; i < keys.length; i += 5) {
    await Promise.all(keys.slice(i, i + 5).map(async (k) => {
      const url = prUrl(k);
      if (!url) return;
      try {
        out[k] = prOf(k, JSON.parse(await gh(["pr", "view", url, "--json", "number,title,state,isDraft,reviewDecision,statusCheckRollup,url"], signal)) as GhPr);
      } catch (error) {
        if (signal.aborted) throw error;
        failed = error;
      }
    }));
  }
  // 一个都没查到、又出过错：多半是 gh 没登录或断网，算这一轮 GitHub 查不成。
  if (Object.keys(out).length === 0 && failed !== null) throw failed;
  return out;
}

export interface LinkDeps {
  jira: { cli: JiraCli; site: string } | null;
  gh: GhRunner | null;
  slackWorkspace: string | null;
  // Jira 站点（拼导入事情的单子链接用）；查 Jira 的话就是 jira.site。
  site: string | null;
}

const live = (t: Thing) => t.status !== "done" && t.status !== "dropped";

// 查一轮。上一轮的结果（prev）在这一轮查不成时接着用：旧的状态总比没有强，标签上照样能点。
export async function collectLinks(
  things: readonly Thing[], replies: readonly Reply[], eventOf: (id: number) => ChiefEvent | null,
  deps: LinkDeps, prev: LinksFile, signal: AbortSignal, now = new Date(),
): Promise<LinksFile> {
  const active = things.filter(live);
  const keys = active.flatMap((t) => t.keys ?? []);
  const jiraKeys = [...new Set(jiraKeysIn(keys))].slice(0, MAX_JIRA);
  const prKeys = [...new Set(prKeysIn(keys))].slice(0, MAX_PRS);
  const errors: Record<string, string> = {};
  const why = (e: unknown) => one(e instanceof Error ? e.message : String(e), 160);

  let jira: Record<string, JiraLink> = Object.fromEntries(jiraKeys.flatMap((k) => (prev.jira[k] ? [[k, prev.jira[k]!]] : [])));
  if (deps.jira && jiraKeys.length > 0) {
    try {
      const got = await fetchJira(deps.jira.cli, deps.jira.site, jiraKeys, signal);
      // 子任务的父单（需求）也查一下状态：阶段看的是需求。
      const parents = [...new Set(Object.values(got).flatMap((j) => (j.parent && !got[j.parent] ? [j.parent] : [])))].slice(0, MAX_JIRA);
      jira = { ...got, ...(parents.length > 0 ? await fetchJira(deps.jira.cli, deps.jira.site, parents, signal) : {}) };
    } catch (error) {
      if (signal.aborted) throw error;
      errors.jira = why(error);
      // 查不成：接着用上一轮的，父单也留着。
      for (const j of Object.values(jira)) if (j.parent && prev.jira[j.parent]) jira[j.parent] = prev.jira[j.parent]!;
    }
  } else if (!deps.jira && jiraKeys.length > 0) errors.jira = "Jira 没连上（没装 acli / twg，或在设置里关了）";

  let prs: Record<string, PrLink> = Object.fromEntries(prKeys.flatMap((k) => (prev.prs[k] ? [[k, prev.prs[k]!]] : [])));
  if (deps.gh && prKeys.length > 0) {
    try {
      prs = { ...prs, ...(await fetchPrs(deps.gh, prKeys, signal)) };
    } catch (error) {
      if (signal.aborted) throw error;
      errors.github = why(error);
    }
  } else if (!deps.gh && prKeys.length > 0) errors.github = "GitHub 没连上（没装 gh，或在设置里关了）";

  const origins: Record<string, OriginLink> = {};
  for (const t of active) {
    const o = originOf(t, eventOf, deps.slackWorkspace, deps.site);
    if (o) origins[String(t.id)] = o;
  }
  // 等你确认的回复：回的是哪条消息，卡片上能点开原消息。
  const messages: Record<string, string> = {};
  for (const r of replies) {
    if (r.status !== "pending" && r.status !== "failed" && r.status !== "queued") continue;
    const e = eventOf(r.event);
    const url = e ? messageUrl(e, deps.slackWorkspace) : null;
    if (url) messages[String(r.event)] = url;
  }
  return { at: now.toISOString(), jira, prs, origins, messages, errors, jiraSite: deps.site };
}

// Jira 没登录时也想拼出单子的链接：从收到过的 Jira 消息的地址里认出站点。
export function siteFromEvents(events: readonly ChiefEvent[]): string | null {
  for (const e of [...events].reverse()) {
    const m = e.source === "jira" && e.url ? /^https:\/\/([a-z0-9-]+\.atlassian\.net)\//.exec(e.url) : null;
    if (m) return m[1]!;
  }
  return null;
}
