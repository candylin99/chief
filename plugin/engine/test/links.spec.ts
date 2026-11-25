import { describe, expect, it } from "vitest";
import { ciOf, collectLinks, EMPTY_LINKS, prOf, siteFromEvents, slackPermalink, talksOf } from "../src/links";
import { jiraStage, parseStage, prStage, stageOf, ticketKeysIn } from "../src/shared/stage";
import type { JiraCli } from "../src/sources/jira";
import type { ChiefEvent, Thing } from "../src/shared/types";

const thing = (over: Partial<Thing>): Thing => ({ id: 1, title: "x", status: "doing", progress: "", events: [], updatedAt: "2026-11-24T00:00:00Z", log: [], ...over });
const ev = (over: Partial<ChiefEvent>): ChiefEvent => ({ id: 1, at: "2026-11-24T00:00:00Z", source: "slack", kind: "message.received", title: "#rc-dev", url: null, from: "bob", text: "", why: ["mention"], keys: [], reply: {}, ...over });

describe("阶段", () => {
  it("RTC 的 Jira 状态都换成七个阶段之一，ON HOLD 是暂停", () => {
    expect(jiraStage("OPEN")).toBe("plan");
    expect(jiraStage("Under development")).toBe("dev");
    expect(jiraStage("Test In Progress")).toBe("testing");
    expect(jiraStage("Acceptance Check")).toBe("testing");
    expect(jiraStage("Ready To Deploy")).toBe("ready");
    expect(jiraStage("Test In Production")).toBe("live");
    expect(jiraStage("Released")).toBe("live");
    expect(jiraStage("Closed")).toBe("live");
    expect(jiraStage("ON HOLD")).toBe("hold");
  });

  it("认不出的按大类：进行中不知道哪一步", () => {
    expect(jiraStage("Something Odd", "new")).toBe("plan");
    expect(jiraStage("Something Odd", "done")).toBe("live");
    expect(jiraStage("Something Odd", "indeterminate")).toBeNull();
  });

  it("汇报里写中文、带空格、写 id、旧版的 id 都认", () => {
    expect(parseStage("计划中")).toBe("plan");
    expect(parseStage("方案中")).toBe("design");
    expect(parseStage("评审用例中")).toBe("casereview");
    expect(parseStage("QA 用例评审")).toBe("casereview");
    expect(parseStage("提测")).toBe("testing");
    expect(parseStage("已上线")).toBe("live");
    expect(parseStage("暂停")).toBe("hold");
    expect(parseStage("released")).toBe("live");
    expect(parseStage("随便写的")).toBeNull();
  });

  it("有 Jira 按 Jira，只在 Jira 还是计划中时用汇报的；没有 Jira 用汇报的，再看 PR", () => {
    expect(stageOf("dev", "testing")).toEqual({ stage: "dev", paused: false });
    expect(stageOf("plan", "design")).toEqual({ stage: "design", paused: false });
    expect(stageOf("plan", null)).toEqual({ stage: "plan", paused: false });
    expect(stageOf(null, "casereview", "dev")).toEqual({ stage: "casereview", paused: false });
    expect(stageOf(null, null, "dev")).toEqual({ stage: "dev", paused: false });
    expect(stageOf(null, null, null)).toEqual({ stage: null, paused: false });
  });

  it("Jira ON HOLD 或汇报写暂停：叠暂停标记，阶段照规则另取", () => {
    expect(stageOf("hold", null, "dev")).toEqual({ stage: "dev", paused: true });
    expect(stageOf("dev", "hold")).toEqual({ stage: "dev", paused: true });
  });

  it("PR 推断：有开着的算开发中，全合了算待发布", () => {
    expect(prStage([{ state: "open" }, { state: "merged" }])).toBe("dev");
    expect(prStage([{ state: "merged" }, { state: "closed" }])).toBe("ready");
    expect(prStage([{ state: "closed" }])).toBeNull();
    expect(prStage([])).toBeNull();
  });

  it("标题里的单号认出来，像单号的编码不算", () => {
    expect(ticketKeysIn("RTC-35159 S1 Shopper 状态卡，跟 RTC-34362 一起")).toEqual(["RTC-35159", "RTC-34362"]);
    expect(ticketKeysIn("UTF-8 和 ISO-8601")).toEqual([]);
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

describe("在哪讨论过", () => {
  const events = new Map<number, ChiefEvent>([
    [3, ev({ id: 3, kind: "chief.missed", title: "漏掉了：#5" })],
    [5, ev({ id: 5, at: "2026-11-24T01:00:00Z", title: "#proj-rtc", from: "Marnie", text: "这个能上线吗", keys: ["slack:C0BAEDD58H1:1794968277.845879"], reply: { channel: "C0BAEDD58H1", ts: "1794968277.845879" } })],
    [6, ev({ id: 6, at: "2026-11-24T03:00:00Z", title: "#proj-rtc", from: "Bob", text: "我再看看", keys: ["slack:C0BAEDD58H1:1794968277.845879"], reply: { channel: "C0BAEDD58H1", ts: "1794968299.000100", thread_ts: "1794968277.845879" } })],
    [7, ev({ id: 7, at: "2026-11-24T02:00:00Z", title: "Alice", from: "Alice", text: "私信问一下", keys: ["slack:D0ABCDEFG:1794968300.000100"], reply: { channel: "D0ABCDEFG", ts: "1794968300.000100" } })],
    [8, ev({ id: 8, at: "2026-11-24T04:00:00Z", source: "github", kind: "github.pr", title: "AfterShip/admin#10797 fix", url: "https://github.com/AfterShip/admin/pull/10797", from: null, text: "approve 了", reply: { ref: "AfterShip/admin#10797" } })],
    [9, ev({ id: 9, at: "2026-11-24T05:00:00Z", source: "session", kind: "session.update", title: "会话", text: "做完了" })],
    [10, ev({ id: 10, source: "jira", kind: "jira.issue", title: "RTC-1 做个东西", url: "https://aftership.atlassian.net/browse/RTC-1", reply: { key: "RTC-1" } })],
  ]);
  const of = (id: number) => events.get(id) ?? null;

  it("按对话合起来、最近的在前；会话汇报和补交的提醒不算；最早来的那处标 first", () => {
    const list = talksOf(thing({ events: [3, 5, 6, 7, 8, 9] }), of, "aftership");
    expect(list.map((x) => [x.source, x.label, x.count])).toEqual([["github", "admin#10797", 1], ["slack", "#proj-rtc", 2], ["slack", "Alice", 1]]);
    expect(list[1]).toMatchObject({ first: true, said: "Bob：我再看看", url: "https://aftership.slack.com/archives/C0BAEDD58H1/p1794968299000100?thread_ts=1794968277.845879&cid=C0BAEDD58H1" });
    expect(list[0]!.url).toBe("https://github.com/AfterShip/admin/pull/10797");
  });

  it("没有消息的看 Slack thread 键补一处；什么都没有是空的", () => {
    expect(talksOf(thing({ keys: ["slack:C0BAEDD58H1:1794968277.845879"] }), of, "aftership")[0]?.url).toBe("https://aftership.slack.com/archives/C0BAEDD58H1/p1794968277845879");
    expect(talksOf(thing({ keys: ["RTC-1"] }), of, "aftership")).toEqual([]);
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

  it("标题里写了单号的也查；连着失败记下从什么时候开始，好了就清掉", async () => {
    const asked: string[] = [];
    const deps = { jira: { cli: cli(async (jql) => { asked.push(jql); return [issue("RTC-5", "OPEN")] as never; }), site: "x" }, gh: null, slackWorkspace: null, site: null };
    await collectLinks([thing({ title: "RTC-5 状态卡" })], [], () => null, deps, EMPTY_LINKS, signal);
    expect(asked).toEqual(["key in (RTC-5)"]);
    const bad = { ...deps, jira: { cli: cli(async () => { throw new Error("acli 没登录 Jira"); }), site: "x" } };
    const first = await collectLinks([thing({ keys: ["RTC-5"] })], [], () => null, bad, EMPTY_LINKS, signal, new Date("2026-11-24T00:00:00Z"));
    const again = await collectLinks([thing({ keys: ["RTC-5"] })], [], () => null, bad, first, signal, new Date("2026-11-24T00:10:00Z"));
    expect(again.failingSince.jira).toBe("2026-11-24T00:00:00.000Z");
    const ok = await collectLinks([thing({ keys: ["RTC-5"] })], [], () => null, deps, again, signal);
    expect(ok.failingSince).toEqual({});
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
