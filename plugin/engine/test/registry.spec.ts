import { describe, expect, it } from "vitest";
import { HANDLE_LABELS, REPLY_MODE_LABELS } from "../src/shared/rules";
import { SCENARIOS, SCENARIO_META, SOURCE_IDS, SOURCE_LABELS, SOURCE_META, scenarioOf, type SourceMeta } from "../src/shared/sources";
import { DESCRIPTORS, SOURCES } from "../src/sources/registry";
import { defaultPolicy } from "../src/store";

// 来源名单（shared/sources.ts）和注册表（sources/registry.ts）对得上：加来源时漏了哪一样，这里会说。
describe("来源注册表", () => {
  it("名单里的每个来源都有一份，编号、名字对得上", () => {
    expect(DESCRIPTORS.map((d) => d.id)).toEqual(SOURCE_IDS);
    for (const id of SOURCE_IDS) {
      expect(SOURCES[id].id).toBe(id);
      expect(SOURCES[id].meta).toBe(SOURCE_META[id]);
      expect(SOURCE_LABELS[id]).toBe(SOURCE_META[id].label);
      expect(SOURCE_META[id].label.trim()).not.toBe("");
    }
  });

  it("每个场景都有名字和合法的默认做法，默认规矩里一个不少、顺序一样", () => {
    for (const [k, m] of Object.entries(SCENARIO_META)) {
      expect(m.label.trim(), k).not.toBe("");
      expect(m.handle in HANDLE_LABELS, k).toBe(true);
      if (m.reply !== undefined) expect(m.reply in REPLY_MODE_LABELS, k).toBe(true);
      // 「当成我的指令」只给你自己发的话用。
      if (m.handle === "command") expect(k).toBe("slack_self");
      expect(SCENARIOS[k as keyof typeof SCENARIOS]).toBe(m.label);
    }
    expect(Object.keys(defaultPolicy().scenarios)).toEqual(Object.keys(SCENARIOS));
    expect(Object.keys(SCENARIOS).slice(-2)).toEqual(["session_update", "other"]);
  });

  it("事件的 why 拼出来的场景认得出来", () => {
    for (const id of SOURCE_IDS) {
      for (const why of Object.keys(SOURCE_META[id].scenarios)) expect(scenarioOf({ source: id, why: [why] })).toBe(`${id}_${why}`);
      expect(scenarioOf({ source: id, why: ["missed"] })).toBe("other");
    }
    expect(scenarioOf({ source: "session", why: ["update"] })).toBe("session_update");
  });

  it("每个来源该有的都有：拉的能建、能变成事件；存钥匙的有钥匙名；只读的说清为什么", () => {
    for (const d of DESCRIPTORS) {
      const meta: SourceMeta = d.meta;
      if (meta.mode === "poll") {
        expect(d.build, d.id).toBeTypeOf("function");
        expect(d.event, d.id).toBeTypeOf("function");
      } else expect(d.build, d.id).toBeUndefined();
      const kind = meta.setup.kind;
      if (kind === "cli") {
        expect(d.local, d.id).toBeTypeOf("function");
        expect(d.secret, d.id).toBeUndefined();
      } else {
        expect(d.secret, d.id).toMatch(/^[a-z0-9_.-]{1,64}$/);
        expect(meta.secretLabel, d.id).toBeTruthy();
      }
      // Slack 的回复由引擎接的 SlackPlugin 发；其余的要么能评论，要么说明只读。
      if (d.id !== "slack") expect(d.comment !== undefined || meta.readOnly !== undefined, d.id).toBe(true);
      if (d.open) expect(d.open.rank).toBeTypeOf("number");
    }
  });

  it("事件的键和回复去处由来源自己说", () => {
    const item = { externalId: "x", kind: "k", title: "t", url: "https://github.com/acme/shop/pull/7", summary: "s", at: "2026-01-01T00:00:00Z", mine: true };
    expect(SOURCES.github.event!({ ...item, payload: { repo: "acme/shop", number: 7 } })).toEqual({ key: "github.com/acme/shop/pull/7", reply: { ref: "acme/shop#7" } });
    expect(SOURCES.jira.event!({ ...item, payload: { key: "PROJ-1" } })).toEqual({ key: "PROJ-1", reply: { key: "PROJ-1" } });
    expect(SOURCES.notion.event!({ ...item, payload: { pageId: "abc" } })).toEqual({ key: "notion:abc", reply: { page: "abc" } });
  });
});
