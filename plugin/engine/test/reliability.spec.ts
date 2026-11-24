// 坏文件、格式升级、config.json、日志、events --follow 的读法、去掉密钥、Slack 登录失效的通知。
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, setConfig, validateConfig, defaultConfig } from "../src/config";
import { notifyCorrupt, recoverSending, slackDeadChanged } from "../src/engine";
import { rotateLog, tailLines } from "../src/logfile";
import { MIGRATIONS, migrateAll } from "../src/migrate";
import { scrubTokens } from "../src/scrub";
import { CorruptFileError, SCHEMA, loadCorrupt, loadReplies, loadThings, paths, readJson, updateReplies, writeJson } from "../src/store";
import { LineTail } from "../src/tail";

const ROOT = resolve(import.meta.dirname, "..");
const TSX = join(ROOT, "node_modules", "tsx", "dist", "esm", "index.mjs");
const CLI = join(ROOT, "src", "cli.ts");

let saved: string | undefined;
let h: string;
beforeEach(() => {
  saved = process.env.CHIEF_HOME;
  h = mkdtempSync(join(tmpdir(), "chief-rel-"));
  process.env.CHIEF_HOME = h;
});
afterEach(() => {
  process.env.CHIEF_HOME = saved;
});

function chief(...args: string[]): string {
  return execFileSync(process.execPath, ["--import", TSX, CLI, ...args], { env: { ...process.env, CHIEF_HOME: h }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
}
function chiefFails(...args: string[]): string {
  try {
    chief(...args);
  } catch (error) {
    return String((error as { stderr?: string }).stderr);
  }
  throw new Error("没失败");
}

describe("坏了的数据文件", () => {
  it("没有的用默认的；空的：一般文件用默认的，要紧的当成坏了", () => {
    expect(readJson(join(h, "replies.json"), { nextId: 1 })).toEqual({ nextId: 1 });
    writeFileSync(join(h, "dispatch.json"), "  \n");
    expect(readJson(join(h, "dispatch.json"), {})).toEqual({});
    writeFileSync(join(h, "replies.json"), "  \n");
    expect(() => readJson(join(h, "replies.json"), { nextId: 1 })).toThrow(CorruptFileError);
  });

  it("手改的 config.json 写坏了：升级不挪走它", () => {
    const bad = '{"pollMinutes": 2,}';
    writeFileSync(paths().config, bad);
    migrateAll();
    expect(readFileSync(paths().config, "utf8")).toBe(bad);
    expect(readdirSync(h).some((f) => f.startsWith("config.json.corrupt"))).toBe(false);
  });

  it("旧版引擎排上、没记内容指纹的：重启后放回待发出", () => {
    writeJson(paths().replies, { nextId: 3, items: [
      { id: 1, event: 1, source: "slack", target: { channel: "D1", ts: "1.1" }, body: "好", status: "queued", by: "you", sendAt: new Date().toISOString(), confirm: { how: "panel", at: new Date().toISOString() }, at: new Date().toISOString() },
      { id: 2, event: 2, source: "slack", target: { channel: "D1", ts: "1.2" }, body: "嗯", status: "sending", by: "you", at: new Date().toISOString() },
    ] });
    recoverSending();
    const [a, b] = loadReplies().items;
    expect(a).toMatchObject({ status: "pending" });
    expect(a!.by).toBeUndefined();
    expect(b).toMatchObject({ status: "failed" });
  });

  it("要紧的（replies）坏了：报错、不覆盖，另存一份，只存一次，记进 corrupt.json", () => {
    writeFileSync(paths().replies, '{"nextId": 42, "items": [');
    expect(() => loadReplies()).toThrow(CorruptFileError);
    expect(() => updateReplies((r) => { r.items = []; })).toThrow(/replies\.json 坏了/);
    // 原文件一个字没动，没被拿空的盖掉。
    expect(readFileSync(paths().replies, "utf8")).toBe('{"nextId": 42, "items": [');
    const copies = () => readdirSync(h).filter((f) => f.startsWith("replies.json.corrupt-"));
    expect(copies()).toHaveLength(1);
    expect(() => loadReplies()).toThrow(CorruptFileError);
    expect(copies()).toHaveLength(1);
    const rec = loadCorrupt()["replies.json"]!;
    expect(rec.critical).toBe(true);
    expect(rec.moved).toBe(join(h, copies()[0]!));
    // 锁放掉了：修好以后照常能写。
    writeFileSync(paths().replies, '{"nextId": 42, "items": []}');
    updateReplies((r) => { r.items = []; });
    expect(loadReplies().nextId).toBe(42);
  });

  it("命令行碰到坏的 things.json：中文报错退出，不从 1 开始编号", () => {
    writeFileSync(paths().things, "{oops");
    expect(chiefFails("thing", "list")).toMatch(/things\.json 坏了/);
    expect(readFileSync(paths().things, "utf8")).toBe("{oops");
  });

  it("不要紧的（routes）坏了：挪走，照旧用默认的", () => {
    writeFileSync(paths().routes, "nope");
    expect(readJson(paths().routes, {})).toEqual({});
    expect(existsSync(paths().routes)).toBe(false);
    expect(readdirSync(h).some((f) => f.startsWith("routes.json.corrupt-"))).toBe(true);
    expect(loadCorrupt()["routes.json"]?.critical).toBe(false);
  });

  it("引擎把它拼成一条 health，修好了就不算了", () => {
    writeFileSync(paths().state, "{");
    expect(() => readJson(paths().state, {})).toThrow(CorruptFileError);
    const said: string[] = [];
    const health = notifyCorrupt(Date.now(), (title) => said.push(title));
    expect(said).toEqual(["chief · state.json 坏了"]);
    expect(notifyCorrupt(Date.now(), (title) => said.push(title))?.ok).toBe(false);
    expect(said).toHaveLength(1);
    expect(health?.ok).toBe(false);
    expect(health?.fails).toBeGreaterThanOrEqual(2);
    expect(health?.error).toMatch(/state\.json 坏了/);
    expect(loadCorrupt()["state.json"]?.notified).toBe(true);
    writeFileSync(paths().state, "{}");
    expect(notifyCorrupt(Date.now(), () => {})).toBeNull();
    expect(loadCorrupt()).toEqual({});
  });

  it("writeJson 写完能读回来，盖上格式版本", () => {
    writeJson(paths().replies, { nextId: 3, items: [] });
    expect(JSON.parse(readFileSync(paths().replies, "utf8"))).toEqual({ version: SCHEMA["replies.json"], nextId: 3, items: [] });
    // 不在 SCHEMA 里的（按编号做键的表）不加。
    writeJson(paths().dispatch, { "1": { status: "noted", at: "x" } });
    expect(JSON.parse(readFileSync(paths().dispatch, "utf8"))).toEqual({ "1": { status: "noted", at: "x" } });
    expect(readdirSync(h).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});

describe("格式升级", () => {
  it("每个有版本的文件都有升级步骤，步数等于版本号", () => {
    for (const [f, v] of Object.entries(SCHEMA)) expect(MIGRATIONS[f]?.length, f).toBe(v);
  });

  it("没有版本号的旧文件：补上缺的字段，编号接着已有的往下", () => {
    writeFileSync(paths().replies, JSON.stringify({ items: [{ id: 7 }, { id: 3 }] }));
    writeFileSync(paths().things, JSON.stringify({ things: [{ id: 2, title: "x" }], asks: [] }));
    writeFileSync(paths().state, JSON.stringify({ nextId: 9 }));
    expect(migrateAll().sort()).toEqual(["replies.json", "state.json", "things.json"]);
    expect(JSON.parse(readFileSync(paths().replies, "utf8"))).toMatchObject({ version: 1, nextId: 8 });
    const t = loadThings();
    expect(t).toMatchObject({ version: 1, nextThing: 3, nextAsk: 1 });
    expect(t.things[0]).toMatchObject({ events: [], log: [] });
    expect(JSON.parse(readFileSync(paths().state, "utf8"))).toMatchObject({ version: 1, nextId: 9, seen: [], threads: [], sent: [], since: {} });
    // 再跑一遍什么都不改。
    expect(migrateAll()).toEqual([]);
  });

  it("比现在新的（新版写的）不动；坏了的要紧文件跳过，不报错", () => {
    writeFileSync(paths().hub, JSON.stringify({ version: 99, cursor: 5 }));
    writeFileSync(paths().replies, "{");
    expect(migrateAll()).toEqual([]);
    expect(JSON.parse(readFileSync(paths().hub, "utf8"))).toEqual({ version: 99, cursor: 5 });
  });

  it("命令行起来时就升级", () => {
    writeFileSync(paths().hub, JSON.stringify({ cursor: 5 }));
    expect(chief("cursor").trim()).toBe("5");
    expect(JSON.parse(readFileSync(paths().hub, "utf8"))).toEqual({ version: 1, cursor: 5 });
  });
});

describe("config.json", () => {
  it("没有文件：默认值就是原来写死的那些", () => {
    expect(loadConfig()).toEqual({ config: defaultConfig(), problems: [] });
    expect(defaultConfig()).toMatchObject({ pollMinutes: 5, firstLookbackHours: 24, missedMinutes: 10, hubDownMinutes: 5, nagMinutes: 30, keepDays: 7, undoSeconds: 5, items: { github: 50, jira: 50 }, slackCatchUpHours: 48, logMaxMB: 10, locale: "zh", quietHours: null, digest: { morning: null, evening: null } });
  });

  it("不认得的键不管；值不对用默认的、超出范围取边界，每个说一句", () => {
    const { config, problems } = validateConfig({ pollMinutes: "fast", missedMinutes: 99999, items: { github: 500 }, locale: "fr", quietHours: { start: "22:00", end: "8am" }, digest: { morning: "08:30", evening: 7 }, whatever: 1 });
    expect(config.pollMinutes).toBe(5);
    expect(config.missedMinutes).toBe(1440);
    expect(config.items).toEqual({ github: 100, jira: 50 });
    expect(config.locale).toBe("zh");
    expect(config.quietHours).toBeNull();
    expect(config.digest).toEqual({ morning: "08:30", evening: null });
    expect(problems).toHaveLength(6);
  });

  it("文件写坏了：全用默认值，说一句，不挪走", () => {
    writeFileSync(paths().config, "{bad");
    const { config, problems } = loadConfig();
    expect(config).toEqual(defaultConfig());
    expect(problems[0]).toMatch(/config\.json 读不了/);
    expect(existsSync(paths().config)).toBe(true);
  });

  it("set 改一项；值不对报错、不写", () => {
    setConfig("pollMinutes", "15");
    setConfig("digest.morning", "08:30");
    setConfig("quietHours", '{"start":"22:00","end":"07:00"}');
    expect(loadConfig().config).toMatchObject({ pollMinutes: 15, digest: { morning: "08:30", evening: null }, quietHours: { start: "22:00", end: "07:00" } });
    expect(() => setConfig("pollMinutes", "0")).toThrow(/1–120/);
    expect(() => setConfig("locale", "fr")).toThrow(/locale/);
    expect(() => setConfig("__proto__", "1")).toThrow(/没有/);
    expect(loadConfig().config.pollMinutes).toBe(15);
  });

  it("chief config 打出生效的值，chief config set 改", () => {
    expect(JSON.parse(chief("config")).undoSeconds).toBe(5);
    chief("config", "set", "undoSeconds", "10");
    expect(JSON.parse(chief("config")).undoSeconds).toBe(10);
    expect(chiefFails("config", "set", "nope", "1")).toMatch(/没有 nope/);
  });
});

describe("日志", () => {
  it("超过上限就换，留两份旧的；空的不换", () => {
    const f = join(h, "engine.log");
    writeFileSync(f, "");
    expect(rotateLog(f)).toBe(false);
    for (const n of [1, 2, 3]) {
      writeFileSync(f, `第 ${n} 份\n`);
      expect(rotateLog(f, 2)).toBe(true);
    }
    expect(readFileSync(f, "utf8")).toBe("");
    expect(readFileSync(`${f}.1`, "utf8")).toBe("第 3 份\n");
    expect(readFileSync(`${f}.2`, "utf8")).toBe("第 2 份\n");
    expect(existsSync(`${f}.3`)).toBe(false);
    writeFileSync(f, "小\n");
    expect(rotateLog(f, 1024)).toBe(false);
  });

  it("只读结尾一段", () => {
    const f = join(h, "big.log");
    writeFileSync(f, Array.from({ length: 5000 }, (_, i) => `第 ${i} 行`).join("\n") + "\n");
    expect(tailLines(f, 3, 200)).toEqual(["第 4997 行", "第 4998 行", "第 4999 行"]);
    expect(tailLines(f, 2)).toEqual(["第 4998 行", "第 4999 行"]);
  });

  it("去掉像密钥的东西", () => {
    const out = scrubTokens("gh: Bad credentials ghp_abcdefghijklmnopqrstuvwxyz0123 Authorization: Bearer abc.def.ghijkl https://me:hunter22@example.com token=s3cretvalue xoxd-AAA%2Fbbb");
    expect(out).not.toMatch(/ghp_|abc\.def|hunter22|s3cretvalue|xoxd-AAA/);
    expect(out).toContain("Bad credentials");
    expect(scrubTokens("PROJ-479 没找到")).toBe("PROJ-479 没找到");
  });
});

describe("events --follow 的读法", () => {
  it("只读追加的；半行留到下次；换了文件（归档重写）从头读", () => {
    const f = join(h, "events.jsonl");
    const t = new LineTail(f);
    expect(t.read()).toEqual([]);
    writeFileSync(f, '{"id":1}\n{"id":2}\n{"id":');
    expect(t.read()).toEqual(['{"id":1}', '{"id":2}']);
    expect(t.read()).toEqual([]);
    appendFileSync(f, '3,"t":"中文"}\n');
    expect(t.read()).toEqual(['{"id":3,"t":"中文"}']);
    // 归档：写个新文件改名换上去（比原来还长也认得出来）。
    writeFileSync(`${f}.tmp`, '{"id":2}\n{"id":3,"t":"中文"}\n{"id":4,"t":"更长的一行，比原来的文件还长"}\n');
    renameSync(`${f}.tmp`, f);
    expect(t.read()).toEqual(['{"id":2}', '{"id":3,"t":"中文"}', '{"id":4,"t":"更长的一行，比原来的文件还长"}']);
    // 截短了也从头读。
    writeFileSync(f, '{"id":5}\n');
    expect(t.read()).toEqual(['{"id":5}']);
  });
});

describe("Slack 登录失效", () => {
  it("从好的变失效弹一次，一直失效不再弹，连上以后再失效再弹", () => {
    let dead = false;
    const step = (s: Parameters<typeof slackDeadChanged>[1]) => {
      const r = slackDeadChanged(dead, s);
      dead = r.dead;
      return r.notify;
    };
    expect(step({ state: "error", error: "连不上" })).toBe(false);
    expect(step({ state: "error", error: "Cookie 已失效", dead: true })).toBe(true);
    expect(step({ state: "connecting" })).toBe(false);
    expect(step({ state: "error", error: "Cookie 已失效", dead: true })).toBe(false);
    expect(step({ state: "connected", account: "" })).toBe(false);
    expect(step({ state: "error", error: "Cookie 已失效", dead: true })).toBe(true);
  });
});
