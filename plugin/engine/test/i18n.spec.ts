import { describe, expect, it } from "vitest";
import { DICTS } from "../../hooks/i18n";
import { LABELS } from "../src/shared/i18n";
import { MESSAGES } from "../src/messages";

// 面板的字典（plugin/hooks/i18n.ts）也在这里 import：tsc --noEmit 会连它一起查，en 少一项就报错。
// 运行时再对一遍：每一层的键一样，数组一样长，函数的参数个数一样。
function shape(v: unknown, path = ""): string[] {
  if (typeof v === "function") return [`${path}()${v.length}`];
  if (Array.isArray(v)) return [`${path}[${v.length}]`];
  if (typeof v === "object" && v !== null) return Object.keys(v).sort().flatMap((k) => shape((v as Record<string, unknown>)[k], `${path}.${k}`));
  return [path];
}

const CJK = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/u;

// en 字典里所有的字（函数用占位参数 [1] 跑一遍：当数字、字符串、数组都能用）：不该有中文。说明里引用给 hub 的原话（「开 chief 消息中心」）、语言选项「语言」除外。
function texts(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (typeof v === "function") return [String(v(...Array.from({ length: v.length }, () => [1])))];
  if (Array.isArray(v)) return v.flatMap(texts);
  if (typeof v === "object" && v !== null) return Object.values(v).flatMap(texts);
  return [];
}
const ALLOWED = ["开 chief 消息中心", "chief 消息中心", "语言"];

describe("字典：en 和 zh 一样全", () => {
  it("面板", () => {
    expect(shape(DICTS.en)).toEqual(shape(DICTS.zh));
  });
  it("两边共用的名字", () => {
    expect(shape(LABELS.en)).toEqual(shape(LABELS.zh));
  });
  it("引擎的通知", () => {
    expect(shape(MESSAGES.en)).toEqual(shape(MESSAGES.zh));
  });
  it("en 里没有漏翻的中文", () => {
    for (const dict of [DICTS.en, LABELS.en, MESSAGES.en]) {
      const left = texts(dict).map((x) => ALLOWED.reduce((s, a) => s.split(a).join(""), x)).filter((x) => CJK.test(x));
      expect(left).toEqual([]);
    }
  });
});
