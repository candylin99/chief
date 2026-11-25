import { describe, expect, it } from "vitest";
import { EMPTY_LINKS, prOf } from "../src/links";
import { approveStale, askStaleEvent, prKeyOfRef, spokeAfter, staleAsks, sweepReplies, unstale } from "../src/sweep";
import type { Ask, ChiefEvent, LinksFile, PrLink, Reply, Thing } from "../src/shared/types";

const pr = (state: PrLink["state"], approvedByMe = false): PrLink => ({ ref: "AfterShip/shop#547", url: "https://github.com/AfterShip/shop/pull/547", title: "寄回运单", state, draft: false, review: null, ci: null, ...(approvedByMe ? { approvedByMe: true } : {}) });
const links = (p: PrLink | null, jira: LinksFile["jira"] = {}): LinksFile => ({ ...EMPTY_LINKS, prs: p ? { "github.com/aftership/shop/pull/547": p } : {}, jira });
const approve = (over: Partial<Reply> = {}): Reply => ({
  id: 1, kind: "approve", event: 9, source: "github", target: { ref: "AfterShip/shop#547" }, context: { who: null, where: "", said: "", url: null }, body: "", status: "failed", at: "2026-11-25T01:00:00Z", ...over,
});
const slackReply = (over: Partial<Reply> = {}): Reply => ({
  id: 2, event: 5, source: "slack", target: { channel: "C0RTC", ts: "1795079299.000100", thread_ts: "1795079290.188699" }, context: { who: "Marnie", where: "#proj-rtc", said: "", url: null }, body: "好的", status: "pending", at: "2026-11-25T02:00:00Z", ...over,
});
const ev = (over: Partial<ChiefEvent> = {}): ChiefEvent => ({ id: 5, at: "2026-11-25T01:59:00Z", source: "slack", kind: "message.received", title: "#proj-rtc", url: null, from: "Marnie", text: "能上吗", why: ["thread"], keys: ["slack:C0RTC:1795079290.188699"], reply: {}, ...over });

describe("approve 卡", () => {
  it("认出 PR 的键（和 links.json 一样小写）", () => {
    expect(prKeyOfRef("AfterShip/shopper.warrantycenter.com#547")).toBe("github.com/aftership/shopper.warrantycenter.com/pull/547");
    expect(prKeyOfRef("不是 PR")).toBeNull();
  });

  it("PR 已合并、已关闭、你自己 approve 过才收；开着没 approve 的不收；你恢复过的不再收", () => {
    expect(approveStale(approve(), links(pr("merged")))).toBe("merged");
    expect(approveStale(approve({ status: "pending" }), links(pr("closed")))).toBe("closed");
    expect(approveStale(approve(), links(pr("open", true)))).toBe("approved");
    expect(approveStale(approve(), links(pr("open")))).toBeNull();
    expect(approveStale(approve(), links(null))).toBeNull();
    expect(approveStale(approve({ staleIgnored: true }), links(pr("merged")))).toBeNull();
    expect(approveStale(approve({ status: "sent" }), links(pr("merged")))).toBeNull();
  });

  it("收起记下原来的状态；再扫一遍不变；恢复放回原样，以后不再收", () => {
    const all = [approve()];
    const first = sweepReplies(all, links(pr("merged")), () => null, {}, new Date("2026-11-25T03:00:00Z"));
    expect(first.closed).toHaveLength(1);
    expect(all[0]).toMatchObject({ status: "dropped", stale: { why: "merged", was: "failed", at: "2026-11-25T03:00:00.000Z" } });
    expect(sweepReplies(all, links(pr("merged")), () => null, {}).closed).toHaveLength(0);
    unstale(all[0]!);
    expect(all[0]).toMatchObject({ status: "failed", staleIgnored: true });
    expect(all[0]!.stale).toBeUndefined();
    expect(sweepReplies(all, links(pr("merged")), () => null, {}).closed).toHaveLength(0);
  });

  it("gh 的 reviews 里有你 approve 过的才算", () => {
    const raw = { state: "OPEN", reviews: [{ author: { login: "someone" }, state: "APPROVED" }, { author: { login: "CandyLin99" }, state: "COMMENTED" }] };
    expect(prOf("github.com/a/b/pull/1", raw, "candylin99").approvedByMe).toBeUndefined();
    expect(prOf("github.com/a/b/pull/1", { ...raw, reviews: [...raw.reviews, { author: { login: "candylin99" }, state: "APPROVED" }] }, "candylin99").approvedByMe).toBe(true);
    expect(prOf("github.com/a/b/pull/1", raw, null).approvedByMe).toBeUndefined();
  });
});

describe("你可能已经亲自回过", () => {
  it("卡片生成之后你在同一个 thread 说过话才算；之前说的不算；私信按 dm 的键", () => {
    expect(spokeAfter(slackReply(), ev(), { "slack:C0RTC:1795079290.188699": "2026-11-25T02:30:00Z" })).toBe("2026-11-25T02:30:00Z");
    expect(spokeAfter(slackReply(), ev(), { "slack:C0RTC:1795079290.188699": "2026-11-25T01:30:00Z" })).toBeNull();
    const dm = slackReply({ target: { channel: "D0ALICE", ts: "1795079290.188699" } });
    expect(spokeAfter(dm, ev({ keys: ["slack:D0ALICE:dm"] }), { "slack:D0ALICE:dm": "2026-11-25T02:10:00Z" })).toBe("2026-11-25T02:10:00Z");
    // 不是 Slack、approve、主动发的新消息：不看。
    expect(spokeAfter(slackReply({ source: "github" }), ev(), { "slack:C0RTC:1795079290.188699": "2026-11-25T02:30:00Z" })).toBeNull();
  });

  it("标在卡上、不收、不改状态；同一次说话不重复标", () => {
    const all = [slackReply()];
    const spoke = { "slack:C0RTC:1795079290.188699": "2026-11-25T02:30:00Z" };
    expect(sweepReplies(all, EMPTY_LINKS, () => ev(), spoke).flagged).toHaveLength(1);
    expect(all[0]).toMatchObject({ status: "pending", selfReplied: { at: "2026-11-25T02:30:00Z" } });
    expect(sweepReplies(all, EMPTY_LINKS, () => ev(), spoke).flagged).toHaveLength(0);
  });
});

describe("问题挂的东西办完了", () => {
  const thing: Thing = { id: 3, title: "寄回运单", status: "waiting_you", progress: "", events: [], updatedAt: "", log: [], keys: ["github.com/aftership/shop/pull/547"] };
  const ask = (over: Partial<Ask> = {}): Ask => ({ id: 7, thing: 3, question: "要 approve 这个 PR 吗？", suggest: "approve", status: "open", at: "", ...over });

  it("事情挂的 PR 合了、问题里提到的单子 Done 了：各交一条；关了的问题不交", () => {
    const l = links(pr("merged"), { "RTC-9": { key: "RTC-9", title: "国家下拉", status: "Closed", category: "done", type: "Story", url: "u" } });
    const hits = staleAsks([thing], [ask({ question: "RTC-9 还要排期吗？" }), ask({ id: 8, status: "answered" })], l);
    expect(hits.map((x) => [x.ask.id, x.key])).toEqual([[7, "github.com/aftership/shop/pull/547"], [7, "RTC-9"]]);
    expect(askStaleEvent(hits[0]!, new Date("2026-11-25T03:00:00Z"))).toMatchObject({ source: "chief", kind: "ask.stale", why: ["stale"], keys: ["github.com/aftership/shop/pull/547"] });
    expect(staleAsks([thing], [ask()], links(pr("open")))).toEqual([]);
  });
});
