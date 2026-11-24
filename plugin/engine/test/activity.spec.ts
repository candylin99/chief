import { describe, expect, it } from "vitest";
import { waitingQuestion } from "../src/activity";

describe("会话在等你回答", () => {
  const ask = { type: "assistant", message: { content: [{ type: "tool_use", name: "AskUserQuestion", id: "t1", input: { questions: [{ question: "确认发布吗？" }] } }] } };
  it("最后一个问你的对话框没回答：在等你", () => {
    expect(waitingQuestion([{ type: "user" }, ask])).toBe("确认发布吗？");
  });
  it("回答过了：不算", () => {
    expect(waitingQuestion([ask, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1" }] } }])).toBeNull();
  });
  it("没问过：不算", () => {
    expect(waitingQuestion([{ type: "assistant", message: { content: [{ type: "text", text: "好了" }] } }])).toBeNull();
  });
  const start = (id: string, title: string) => ({ type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__ccd_session__start_session", id, input: { title } }] } });
  it("要开新会话、在等你点 Allow：也算在等你", () => {
    expect(waitingQuestion([{ type: "user" }, start("s1", "FE-02"), start("s2", "FE-05")])).toBe("它要开新会话 「FE-02」、「FE-05」，在等你点 Allow（App 每个都要你点）");
  });
  it("点过了：不算", () => {
    expect(waitingQuestion([start("s1", "FE-02"), { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "s1" }] } }])).toBeNull();
  });
});

describe("命令跑得久不算等你", () => {
  it("一个 Bash 一直没结果（截图、起服务）：不算在等你，要你拍板的由会话自己说", () => {
    const use = { type: "assistant", message: { content: [{ type: "tool_use", id: "b1", name: "Bash", input: { description: "截图" } }] } };
    expect(waitingQuestion([{ type: "user" }, use])).toBeNull();
  });
});
