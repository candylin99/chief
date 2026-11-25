import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { backfill, loadNotices, noteMarked, noticeWorthy, queueRead, reactQueued } from "../src/notices";
import { appendDecision, appendEvent } from "../src/store";
import type { ChiefEvent } from "../src/shared/types";

const ev = (over: Partial<ChiefEvent> = {}): ChiefEvent => ({
  id: 1, at: "2026-11-25T01:00:00Z", source: "slack", kind: "message.received", title: "#proj-rtc", url: null, from: "Jackson", fromId: "U0JACK",
  text: "提测了", why: ["thread"], keys: ["slack:C0RTC:1795079290.188699"], reply: { channel: "C0RTC", ts: "1795079299.000100", thread_ts: "1795079290.188699" }, ...over,
});

beforeEach(() => {
  process.env.CHIEF_HOME = mkdtempSync(join(tmpdir(), "chief-notices-"));
});

describe("哪些只记下的消息出通知卡", () => {
  it("Slack 的私信、@我、thread 后续出卡；群发、GitHub、给自己的话不出", () => {
    expect(noticeWorthy(ev())).toBe(true);
    expect(noticeWorthy(ev({ why: ["dm"] }))).toBe(true);
    expect(noticeWorthy(ev({ why: ["mention"], text: "@here 今晚发版" }))).toBe(false);
    expect(noticeWorthy(ev({ source: "github", why: ["comment"] }))).toBe(false);
    expect(noticeWorthy(ev({ why: ["self"] }))).toBe(false);
    expect(noticeWorthy(ev({ reply: {} }))).toBe(false);
  });

  it("只记下的出一张（同一条不重复）；改判成派活的，没读的卡撤掉；忽略的不出", () => {
    noteMarked([ev(), ev({ id: 2, text: "@channel 群发" })], "noted", "2026-11-25T01:01:00Z", 3);
    noteMarked([ev()], "noted", "2026-11-25T01:02:00Z", 3);
    expect(loadNotices().items).toMatchObject([{ event: 1, who: "Jackson", where: "#proj-rtc", text: "提测了", status: "unread", thing: 3, target: { channel: "C0RTC", ts: "1795079299.000100" } }]);
    noteMarked([ev({ id: 5 })], "ignored", "2026-11-25T01:03:00Z", null);
    expect(loadNotices().items.map((x) => x.event)).toEqual([1]);
    noteMarked([ev()], "forwarded", "2026-11-25T01:04:00Z", null);
    expect(loadNotices().items).toEqual([]);
  });
});

describe("已读 👀", () => {
  it("点一次只加一个 :eyes:；重复点、已经加过的什么都不做", async () => {
    noteMarked([ev()], "noted", "2026-11-25T01:01:00Z", null);
    expect(queueRead(1)).toMatchObject({ status: "queued", changed: true });
    expect(queueRead(1)).toMatchObject({ status: "queued", changed: false });
    const calls: string[] = [];
    const react = async (t: { channel: string; ts: string }) => void calls.push(`${t.channel}:${t.ts}`);
    expect(await reactQueued(react, () => new Date("2026-11-25T02:00:00Z"))).toEqual({ done: [1], failed: [] });
    expect(await reactQueued(react)).toEqual({ done: [], failed: [] });
    expect(queueRead(1)).toMatchObject({ status: "done", changed: false });
    expect(await reactQueued(react)).toEqual({ done: [], failed: [] });
    expect(calls).toEqual(["C0RTC:1795079299.000100"]);
    expect(loadNotices().items[0]).toMatchObject({ status: "done", readAt: "2026-11-25T02:00:00.000Z" });
  });

  it("同一段对话：已读只在最新那条上加 :eyes:，更早没看的跟着算看过；别的对话不动", async () => {
    noteMarked([ev({ id: 1 }), ev({ id: 2, reply: { channel: "C0RTC", ts: "1795079300.000100" } }), ev({ id: 3, keys: ["slack:D0ALICE:dm"], reply: { channel: "D0ALICE", ts: "1.0" } })], "noted", "t", null);
    expect(loadNotices().items.map((x) => x.conv)).toEqual(["slack:C0RTC:1795079290.188699", "slack:C0RTC:1795079290.188699", "slack:D0ALICE:dm"]);
    queueRead(2);
    const calls: string[] = [];
    await reactQueued(async (t) => void calls.push(t.ts));
    expect(calls).toEqual(["1795079300.000100"]);
    expect(loadNotices().items.map((x) => [x.event, x.status, x.covered ?? false])).toEqual([[1, "done", true], [2, "done", false], [3, "unread", false]]);
  });

  it("Slack 说已经加过（already_reacted）算加上了", async () => {
    noteMarked([ev()], "noted", "t", null);
    queueRead(1);
    await reactQueued(async () => { throw new Error("already_reacted"); });
    expect(loadNotices().items[0]!.status).toBe("done");
  });

  it("加不上：标 failed 写明为什么；能再点一次重试", async () => {
    noteMarked([ev()], "noted", "t", null);
    queueRead(1);
    expect(await reactQueued(async () => { throw new Error("message_not_found"); })).toEqual({ done: [], failed: [1] });
    expect(loadNotices().items[0]).toMatchObject({ status: "failed", error: "message_not_found" });
    expect(queueRead(1)).toMatchObject({ status: "queued", changed: true });
    expect(loadNotices().items[0]!.error).toBeUndefined();
    await reactQueued(async () => {});
    expect(loadNotices().items[0]!.status).toBe("done");
  });

  it("Slack 没连上：标 failed，说连上了再点", async () => {
    noteMarked([ev()], "noted", "t", null);
    queueRead(1);
    await reactQueued(null);
    expect(loadNotices().items[0]).toMatchObject({ status: "failed", error: "Slack 还没连上，连上了再点一次" });
  });

  it("没有这条通知：报错", () => {
    expect(() => queueRead(99)).toThrow("没有消息 #99 的通知");
  });
});

describe("补出以前的", () => {
  it("只补最近这些小时里只记下的；已经有卡的不重复", () => {
    const now = Date.parse("2026-11-25T10:00:00Z");
    appendEvent(ev({ id: 1 }));
    appendEvent(ev({ id: 2, reply: { channel: "C0RTC", ts: "1795079300.000100" } }));
    appendEvent(ev({ id: 3, keys: ["slack:D0ALICE:dm"], reply: { channel: "D0ALICE", ts: "1.0" } }));
    const d = (event: number, at: string, verdict: "noted" | "forwarded") => appendDecision({ at, event, scenario: "slack_thread", verdict, reason: "x", what: { source: "slack", title: "", from: null, text: "" } });
    d(1, "2026-11-25T09:00:00Z", "noted");
    d(2, "2026-11-23T09:00:00Z", "noted");
    d(3, "2026-11-25T09:30:00Z", "forwarded");
    expect(backfill(24, now)).toBe(1);
    expect(backfill(24, now)).toBe(0);
    expect(loadNotices().items.map((x) => x.event)).toEqual([1]);
  });
});
