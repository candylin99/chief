import { describe, expect, it } from "vitest";
import { ciOf, collectLinks, EMPTY_LINKS, originOf, prOf, siteFromEvents, slackPermalink } from "../src/links";
import { jiraStage, parseStage, stageOf } from "../src/shared/stage";
import type { JiraCli } from "../src/sources/jira";
import type { ChiefEvent, Thing } from "../src/shared/types";

const thing = (over: Partial<Thing>): Thing => ({ id: 1, title: "x", status: "doing", progress: "", events: [], updatedAt: "2026-11-24T00:00:00Z", log: [], ...over });
const ev = (over: Partial<ChiefEvent>): ChiefEvent => ({ id: 1, at: "2026-11-24T00:00:00Z", source: "slack", kind: "message.received", title: "#rc-dev", url: null, from: "bob", text: "", why: ["mention"], keys: [], reply: {}, ...over });

describe("阶段", () => {
  it("RTC 的 Jira 状态都认得", () => {
    expect(jiraStage("OPEN")).toBe("todo");
    expect(jiraStage("Under development")).toBe("dev");
    expect(jiraStage("Test In Progress")).toBe("testing");
    expect(jiraStage("Acceptance Check")).toBe("acceptance");
    expect(jiraStage("Ready To Deploy")).toBe("ready");
    expect(jiraStage("Test In Production")).toBe("prodcheck");
    expect(jiraStage("Released")).toBe("released");
    expect(jiraStage("ON HOLD")).toBe("hold");
    expect(jiraStage("Closed")).toBe("done");
    expect(jiraStage("Resolved")).toBe("done");
  });

  it("认不出的按大类：进行中不知道哪一步", () => {
    expect(jiraStage("Something Odd", "new")).toBe("todo");
    expect(jiraStage("Something Odd", "done")).toBe("done");
    expect(jiraStage("Something Odd", "indeterminate")).toBeNull();
  });

  it("汇报里写中文、带空格、写 id 都认", () => {
    expect(parseStage("方案中")).toBe("design");
    expect(parseStage("QA 用例评审")).toBe("casereview");
    expect(parseStage("提测")).toBe("handoff");
    expect(parseStage("testing")).toBe("testing");
    expect(parseStage("随便写的")).toBeNull();
  });

  it("Jira 还在待开始 / 开发中时用汇报的更细的阶段，其余按 Jira", () => {
    expect(stageOf("todo", "design")).toBe("design");
    expect(stageOf("dev", "casereview")).toBe("casereview");
    expect(stageOf("testing", "dev")).toBe("testing");
    expect(stageOf(null, "design")).toBe("design");
    expect(stageOf("dev", null)).toBe("dev");
  });
});

describe("Slack 链接", () => {
  it("拼出消息链接，thread 里的带 thread_ts", () => {
    expect(slackPermalink("aftership", "C0BAEDD58H1", "1794968277.845879")).toBe("https://aftership.slack.com/archives/C0BAEDD58H1/p1794968277845879");
    expect(slackPermalink("aftership", "C0BAEDD58H1", "1794968299.000100", "1794968277.845879"))
      .toBe("https://aftership.slack.com/archives/C0BAEDD58H1/p1794968299000100?thread_ts=1794968277.845879&cid=C0BAEDD58H1");
  });

  it("认不出的不拼", () => {
    expect(slackPermalink(null, "C0BAEDD58H1", "1794968277.845879")).toBeNull();
    expect(slackPermalink("evil.com/x", "C0BAEDD58H1", "1794968277.845879")).toBeNull();
    expect(slackPermalink("aftership", "C0B?x", "1794968277.845879")).toBeNull();
  });
});

describe("PR", () => {
  it("CI：挂一个就是挂了，有在跑的是在跑，都过是过了", () => {
    expect(ciOf([])).toBeNull();
    expect(ciOf([{ __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" }, { __typename: "CheckRun", status: "COMPLETED", conclusion: "SKIPPED" }])).toBe("pass");
    expect(ciOf([{ __typename: "CheckRun", status: "IN_PROGRESS", conclusion: null }])).toBe("pending");
    expect(ciOf([{ __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" }, { __typename: "CheckRun", status: "IN_PROGRESS" }])).toBe("fail");
    expect(ciOf([{ __typename: "StatusContext", state: "PENDING" }])).toBe("pending");
    expect(ciOf([{ __typename: "StatusContext", state: "ERROR" }])).toBe("fail");
  });

  it("gh pr view 的结果换成 PR 的样子", () => {
    const pr = prOf("github.com/aftership/shop/pull/12", { title: "fix", state: "OPEN", isDraft: false, reviewDecision: "CHANGES_REQUESTED", statusCheckRollup: [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" }] });
    expect(pr).toEqual({ ref: "aftership/shop#12", url: "https://github.com/aftership/shop/pull/12", title: "fix", state: "open", draft: false, review: "changes", ci: "pass" });
    expect(prOf("github.com/a/b/pull/1", { state: "MERGED" }).state).toBe("merged");
    expect(prOf("github.com/a/b/pull/1", { state: "MERGED", statusCheckRollup: [{ status: "IN_PROGRESS" }] }).ci).toBeNull();
  });
});

describe("从哪来", () => {
  const events = new Map<number, ChiefEvent>([
    [3, ev({ id: 3, kind: "chief.missed", title: "漏掉了：#5" })],
    [5, ev({ id: 5, title: "#proj-warranty", reply: { channel: "C0BAEDD58H1", ts: "1794968277.845879" } })],
    [9, ev({ id: 9, source: "jira", kind: "jira.issue", title: "RTC-1 做个东西", url: "https://aftership.atlassian.net/browse/RTC-1", reply: { key: "RTC-1" } })],
  ]);
  const of = (id: number) => events.get(id) ?? null;

  it("最早一条真消息（补交的提醒不算），Slack 拼链接", () => {
    expect(originOf(thing({ events: [9, 5, 3] }), of, "aftership", null)).toEqual({ source: "slack", label: "#proj-warranty", url: "https://aftership.slack.com/archives/C0BAEDD58H1/p1794968277845879" });
  });

  it("没有消息的看键：Slack thread、Jira、PR", () => {
    expect(originOf(thing({ keys: ["slack:C0BAEDD58H1:1794968277.845879"] }), of, "aftership", null)?.url).toBe("https://aftership.slack.com/archives/C0BAEDD58H1/p1794968277845879");
    expect(originOf(thing({ keys: ["RTC-34362"] }), of, null, "aftership.atlassian.net")).toEqual({ source: "jira", label: "RTC-34362", url: "https://aftership.atlassian.net/browse/RTC-34362" });
    expect(originOf(thing({ keys: ["github.com/aftership/shop/pull/7"] }), of, null, null)).toEqual({ source: "github", label: "shop#7", url: "https://github.com/aftership/shop/pull/7" });
    expect(originOf(thing({}), of, null, null)).toBeNull();
  });

  it("从 Jira 消息的地址认出站点", () => {
    expect(siteFromEvents([...events.values()])).toBe("aftership.atlassian.net");
  });
});

describe("查一轮", () => {
  const issue = (key: string, status: string, parent?: string) => ({ key, fields: { summary: key, status: { name: status, statusCategory: { key: "indeterminate" } }, issuetype: { name: parent ? "FE Sub-task" : "Story" }, ...(parent ? { parent: { key: parent } } : {}) } });
  const cli = (search: JiraCli["search"]): JiraCli => ({ name: "acli", login: "acli jira auth login --web", status: async () => ({ site: "x.atlassian.net", email: "" }), search, view: async () => { throw new Error("no"); }, comment: async () => {} });
  const signal = new AbortController().signal;

  it("子任务顺带查父单（需求）；办完的事情不查", async () => {
    const asked: string[] = [];
    const out = await collectLinks(
      [thing({ id: 1, keys: ["RTC-2", "github.com/a/b/pull/3"] }), thing({ id: 2, status: "done", keys: ["RTC-9"] })], [], () => null,
      {
        jira: { cli: cli(async (jql) => { asked.push(jql); return (jql.includes("RTC-2") ? [issue("RTC-2", "OPEN", "RTC-1")] : [issue("RTC-1", "Test In Progress")]) as never; }), site: "x.atlassian.net" },
        gh: async () => JSON.stringify({ title: "t", state: "OPEN", isDraft: true, reviewDecision: null, statusCheckRollup: [] }),
        slackWorkspace: null, site: "x.atlassian.net",
      }, EMPTY_LINKS, signal, new Date("2026-11-24T00:00:00Z"),
    );
    expect(asked).toEqual(["key in (RTC-2)", "key in (RTC-1)"]);
    expect(out.jira["RTC-2"]?.parent).toBe("RTC-1");
    expect(out.jira["RTC-1"]?.status).toBe("Test In Progress");
    expect(out.prs["github.com/a/b/pull/3"]).toMatchObject({ state: "open", draft: true });
    expect(out.errors).toEqual({});
  });

  it("Jira 没登录：记下为什么，接着用上一轮查到的", async () => {
    const prev = { ...EMPTY_LINKS, jira: { "RTC-2": { key: "RTC-2", title: "", status: "OPEN", category: "new", type: null, parent: "RTC-1", url: "u" }, "RTC-1": { key: "RTC-1", title: "", status: "Released", category: null, type: "Story", url: "u" } } };
    const out = await collectLinks([thing({ keys: ["RTC-2"] })], [], () => null,
      { jira: { cli: cli(async () => { throw new Error("acli 没登录 Jira，到终端里跑 acli jira auth login --web"); }), site: "x" }, gh: null, slackWorkspace: null, site: null }, prev, signal);
    expect(out.errors.jira).toContain("没登录");
    expect(out.jira["RTC-2"]?.status).toBe("OPEN");
    expect(out.jira["RTC-1"]?.status).toBe("Released");
  });

  it("等你确认的回复：原消息能点开", async () => {
    const out = await collectLinks([], [{ id: 1, event: 5, source: "slack", target: {}, context: { who: null, where: "", said: "", url: null }, body: "", status: "pending", at: "" }],
      (id) => (id === 5 ? ev({ id: 5, reply: { channel: "C0BAEDD58H1", ts: "1794968277.845879" } }) : null),
      { jira: null, gh: null, slackWorkspace: "aftership", site: null }, EMPTY_LINKS, signal);
    expect(out.messages["5"]).toBe("https://aftership.slack.com/archives/C0BAEDD58H1/p1794968277845879");
  });
});
