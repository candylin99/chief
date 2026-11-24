import { describe, expect, it } from "vitest";
import { TITLE_OK } from "../src/args";
import { chiefIds } from "../src/plain";

describe("给用户看的话里，看的人得知道每个编号指的是什么", () => {
  it("拦：chief 自己的编号，加了括号也拦", () => {
    expect(chiefIds("问题 #63 已经答过了")).toEqual(["问题 #63"]);
    expect(chiefIds("回复 107 改好了")).toEqual(["回复 107"]);
    expect(chiefIds("事件 #552 漏掉了")).toEqual(["事件 #552"]);
    expect(chiefIds("和事情#3 是同一件事")).toEqual(["事情#3"]);
    expect(chiefIds("回复号 12 等你确认")).toEqual(["回复号 12"]);
    expect(chiefIds("待发出 #99（给 Victor 的回复）先别发")).toEqual(["待发出 #99"]);
  });

  it("拦：编号后面没用括号说清是什么事", () => {
    expect(chiefIds("建议先发 #98，再回 Joe")).toEqual(["#98"]);
    expect(chiefIds("等于把 #179 / #181 的决定推翻了")).toEqual(["#179", "#181"]);
    expect(chiefIds("PR #87 等 George")).toEqual(["PR #87"]);
    expect(chiefIds("PR#12 要改")).toEqual(["PR#12"]);
    expect(chiefIds("Notion #195 那边还要跟")).toEqual(["Notion #195"]);
    expect(chiefIds("shop#535 改法对")).toEqual(["shop#535"]);
    expect(chiefIds("acme/shop#12 加字段")).toEqual(["acme/shop#12"]);
    expect(chiefIds("全角的 ＃98 也算")).toEqual(["＃98"]);
    expect(chiefIds("需求单 PROJ-35191 只写了一句")).toEqual(["PROJ-35191"]);
    expect(chiefIds("PROJ-479、PROJ-480 都提测了")).toEqual(["PROJ-479", "PROJ-480"]);
    // 括号里只有别的编号、或者太短，不算说清了。
    expect(chiefIds("PR #87（#88）")).toEqual(["PR #87", "#88"]);
    expect(chiefIds("PR #87 (x)")).toEqual(["PR #87"]);
    expect(chiefIds("先发 #98，问题 #63 关掉，#98 别忘")).toEqual(["#98", "问题 #63"]);
  });

  it("放：编号后面用括号说清了是什么事", () => {
    for (const ok of [
      "等于把 #179（批准后自动处理）/ #181（寄回运费）的决定推翻了",
      "PR #87（browser-agent 降成本）等 George",
      "Notion #195（要验 OS 侧的那条）那边还要跟",
      "admin #10821 (bot 挑出的文案问题) 已改",
      "acme/shop#12（加字段）请你 review",
      "o/r#3 (登录超时) review",
      "PROJ-35191（自动处理时详情页的状态）还没排期",
      "PROJ-479 (接口加字段) 提测了",
    ]) expect(chiefIds(ok), ok).toEqual([]);
  });

  it("放：链接（连同链接文字）、Jira 单号、数量和时间", () => {
    for (const ok of [
      "PR 在这：https://github.com/acme/shop/pull/12",
      "看 https://github.com/acme/shop/pull/12#issuecomment-123 和 https://github.com/a/b/blob/main/x.ts#L42",
      "[PR #12](https://github.com/o/r/pull/12) 已合",
      "<https://github.com/o/r/pull/12|#12> 已合",
      "Jira 单在这 https://acme.example.net/browse/PROJ-35189",
      "Slack 链接 https://acme.slack.com/archives/C123/p1795079290188699",
      "两件事要你定：1. 要不要本周上线？2. 谁来回 Joe？",
      "问题 2 个，回复 3 条，事件 5 天前",
      "回复 10:30 前给",
      "事情 2026-11-30 截止",
      "颜色用 #fafafa，频道 <#C0123|dev>",
      "文件用 UTF-8 存，哈希用 SHA-256，时间按 ISO-8601",
      "分支 feat/PROJ-35191-status 已推",
      "没问题",
    ]) expect(chiefIds(ok), ok).toEqual([]);
  });

  it("回 GitHub 的评论：#123 是 GitHub 自己的写法，放行；不带 # 的 chief 说法照样拦", () => {
    expect(chiefIds("和 #12 是同一个问题，已在 #13 修了", { github: true })).toEqual([]);
    expect(chiefIds("回复 107 已发", { github: true })).toEqual(["回复 107"]);
    expect(chiefIds("和 #12 是同一个问题")).toEqual(["#12"]);
    expect(chiefIds("对应 PROJ-35191", { github: true })).toEqual(["PROJ-35191"]);
  });

  it("事情标题：带仓库名的编号后面跟着描述就行，单写的 #63 照样拦", () => {
    expect(chiefIds("shop-api#2286 同步 master 到 release/tidy", { title: true })).toEqual([]);
    expect(chiefIds("review track-widgets#367 carrier 下拉只渲染可见行", { title: true })).toEqual([]);
    expect(chiefIds("PROJ-479 接口加字段", { title: true })).toEqual([]);
    expect(chiefIds("PROJ-35191", { title: true })).toEqual(["PROJ-35191"]);
    expect(chiefIds("admin#10651", { title: true })).toEqual(["admin#10651"]);
    expect(chiefIds("跟进 #63", { title: true })).toEqual(["#63"]);
    expect(chiefIds("shop-api#2286 同步 master 到 release/tidy")).toEqual(["shop-api#2286"]);
  });
});

// locale 是 en 时主会话用英文写：英文的说明括号、英文的 chief 编号说法、英文标题。
describe("英文写的话", () => {
  it("放行：外部编号后面跟着英文括号说清是什么事", () => {
    expect(chiefIds("PR #87 (the checkout fix) is waiting on George")).toEqual([]);
    expect(chiefIds("PR #87(the checkout fix) is ready")).toEqual([]);
    expect(chiefIds("PROJ-35191 (status on the detail page) only has one line")).toEqual([]);
    expect(chiefIds("Merged acme/shop#12 (adds the field) and PROJ-479 (API change), shipping Tuesday")).toEqual([]);
    expect(chiefIds("See [PR #12](https://github.com/acme/shop/pull/12) for details")).toEqual([]);
    expect(chiefIds("Bob asked if we can ship this week. Reply next Tuesday?")).toEqual([]);
  });

  it("放行：英文里的数量、时间、日期不是编号", () => {
    expect(chiefIds("Replied to 3 people, 2 questions left")).toEqual([]);
    expect(chiefIds("The reply 2 days ago was enough; event at 10:30")).toEqual([]);
    expect(chiefIds("UTF-8 and SHA-256 are fine")).toEqual([]);
  });

  it("拦：英文的 chief 编号说法，加了括号也拦", () => {
    expect(chiefIds("Reply #107 is ready")).toEqual(["Reply #107"]);
    expect(chiefIds("question #63 was answered")).toEqual(["question #63"]);
    expect(chiefIds("Same as thing #3 (the load test)")).toEqual(["thing #3"]);
    expect(chiefIds("outbox item #99 can wait")).toEqual(["outbox item #99"]);
    expect(chiefIds("event no. #552 was missed")).toEqual(["event no. #552"]);
  });

  it("拦：英文里没说明的外部编号", () => {
    // 小写的普通词不算进编号；大写开头的（PR、Notion，句首的词）当成名字一起报出来，照样拦。
    expect(chiefIds("Please send #98 first, then answer Joe")).toEqual(["#98"]);
    expect(chiefIds("Send #98 first")).toEqual(["Send #98"]);
    expect(chiefIds("PR #87 is waiting on George")).toEqual(["PR #87"]);
    expect(chiefIds("PROJ-35191 only has one line")).toEqual(["PROJ-35191"]);
    expect(chiefIds("PR #87 (x)")).toEqual(["PR #87"]);
  });

  it("回 GitHub 的评论：#123 照样放行；英文标题带仓库名的编号不用括号", () => {
    expect(chiefIds("Fixed in #123, thanks!", { github: true })).toEqual([]);
    expect(chiefIds("Reply #107 sent", { github: true })).toEqual([]);
    expect(chiefIds("shop-api#2286 sync master into release", { title: true })).toEqual([]);
    expect(chiefIds("PROJ-479 add field to the API", { title: true })).toEqual([]);
    expect(chiefIds("Follow up on #63", { title: true })).toEqual(["#63"]);
  });

  it("英文标题：撇号用 ’，& 和破折号也行；直的 ' 和命令替换照样拦", () => {
    expect(TITLE_OK.test("Bob’s PR review — PROJ-479 & docs")).toBe(true);
    expect(TITLE_OK.test("Fix login bug (acme/shop#12)")).toBe(true);
    expect(TITLE_OK.test("Bob's PR")).toBe(false);
    expect(TITLE_OK.test("$(rm -rf ~)")).toBe(false);
  });
});
