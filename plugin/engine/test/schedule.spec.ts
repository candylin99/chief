// 免打扰、每天汇总、导出和彻底删除。数据都在临时目录里；钥匙串用内存的。
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { setConfig } from "../src/config";
import { digestMaterial } from "../src/commands/digest";
import { checkTarget, exportList, exportTo, purgePlan, runPurge } from "../src/commands/export";
import { Engine, flushHeld, say } from "../src/engine";
import { msg } from "../src/messages";
import { heldSince, holdIfQuiet, takeHeld } from "../src/quiet";
import { loadUndo, recordDrop, recordSkip } from "../src/undo";
import { MemorySecretStore } from "../src/secrets";
import { dueDigests, parseQuietRange, quietState } from "../src/shared/schedule";
import { appendEvent, loadState, paths, readEvents, writeJson } from "../src/store";

const ROOT = resolve(import.meta.dirname, "..");
const TSX = join(ROOT, "node_modules", "tsx", "dist", "esm", "index.mjs");
const CLI = join(ROOT, "src", "cli.ts");

let saved: string | undefined;
let h: string;
beforeEach(() => {
  saved = process.env.CHIEF_HOME;
  h = realpathSync(mkdtempSync(join(tmpdir(), "chief-sched-")));
  process.env.CHIEF_HOME = h;
});
afterEach(() => {
  process.env.CHIEF_HOME = saved;
});

function chief(...args: string[]): string {
  return execFileSync(process.execPath, ["--import", TSX, CLI, ...args], { env: { ...process.env, CHIEF_HOME: h }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
}

// 当地时间（测试不管跑在哪个时区）。
const local = (d: number, hh: number, mm = 0) => new Date(2026, 10, d, hh, mm);

describe("免打扰时段", () => {
  it("跨半夜：22:00–08:00 里是免打扰，说到几点", () => {
    const q = { start: "22:00", end: "08:00" };
    expect(quietState(q, local(23, 23, 30))).toEqual({ quiet: true, until: local(24, 8).toISOString() });
    expect(quietState(q, local(24, 7, 59))).toEqual({ quiet: true, until: local(24, 8).toISOString() });
    expect(quietState(q, local(24, 8)).quiet).toBe(false);
    expect(quietState(q, local(24, 21, 59)).quiet).toBe(false);
  });

  it("不跨半夜、没设、开始等于结束", () => {
    expect(quietState({ start: "12:00", end: "13:30" }, local(23, 13)).quiet).toBe(true);
    expect(quietState({ start: "12:00", end: "13:30" }, local(23, 13, 30)).quiet).toBe(false);
    expect(quietState(null, local(23, 3)).quiet).toBe(false);
    expect(quietState({ start: "08:00", end: "08:00" }, local(23, 8)).quiet).toBe(false);
  });

  it("面板填的时段：几种写法都认，认不出的给 null", () => {
    expect(parseQuietRange("22:00-08:00")).toEqual({ start: "22:00", end: "08:00" });
    expect(parseQuietRange(" 9:30 – 12:00 ")).toEqual({ start: "09:30", end: "12:00" });
    expect(parseQuietRange("22:00 到 7:00")).toEqual({ start: "22:00", end: "07:00" });
    expect(parseQuietRange("25:00-08:00")).toBeNull();
    expect(parseQuietRange("晚上十点")).toBeNull();
    expect(parseQuietRange("08:00-08:00")).toBeNull();
  });

  it("免打扰时引擎的通知不弹、记下；要紧的照弹；过了合成一条弹出来", () => {
    // say() 看的是现在几点：钉在晚上 11 点，白天跑也在免打扰里。
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(local(23, 23));
    onTestFinished(() => void vi.useRealTimers());
    setConfig("quietHours", '{"start":"22:00","end":"08:00"}');
    const shown: string[] = [];
    const show = (t: string) => void shown.push(t);
    expect(say("chief · 回复没发出去", "Bob：超时", false, show)).toBe(false);
    expect(say("chief · Slack 登录失效了", "去重新登录", false, show)).toBe(false);
    expect(say("chief · rules.json 坏了", "修好它", true, show)).toBe(true);
    expect(shown).toEqual(["chief · rules.json 坏了"]);
    // 还在免打扰：不弹。
    expect(flushHeld(new Date(), show)).toBe(0);
    expect(heldSince("2000-01-01T00:00:00Z").map((x) => x.title)).toEqual(["chief · 回复没发出去", "chief · Slack 登录失效了"]);
  });

  it("免打扰过了才拿出来，只拿一次", () => {
    setConfig("quietHours", '{"start":"22:00","end":"08:00"}');
    expect(holdIfQuiet("chief · 会话在等你回答", "PROJ-123：选哪个", local(23, 23))).toBe(true);
    expect(holdIfQuiet("chief · 主会话没在听", "有 3 条", local(23, 12))).toBe(false);
    expect(takeHeld(local(24, 2))).toEqual([]);
    expect(takeHeld(local(24, 9)).map((x) => x.title)).toEqual(["chief · 会话在等你回答"]);
    expect(takeHeld(local(24, 9))).toEqual([]);
    // 进汇总的照样在（弹过了也算攒下的）。
    expect(heldSince("2000-01-01T00:00:00Z")).toHaveLength(1);
  });

  it("没设免打扰：照常弹，不记", () => {
    const shown: string[] = [];
    expect(say("chief · 回复没发出去", "x", false, (t) => void shown.push(t))).toBe(true);
    expect(shown).toHaveLength(1);
    expect(existsSync(paths().held)).toBe(false);
  });

  it("chief quiet、chief config set 免打扰马上生效、chief status 带一行", () => {
    expect(JSON.parse(chief("quiet"))).toEqual({ quiet: false, until: null, hours: null });
    expect(chief("config", "set", "quietHours", '{"start":"00:00","end":"23:59"}')).toMatch(/马上生效/);
    const q = JSON.parse(chief("quiet")) as { quiet: boolean; until: string | null; hours: unknown };
    expect(q.hours).toEqual({ start: "00:00", end: "23:59" });
    expect(typeof q.quiet).toBe("boolean");
    chief("config", "set", "quietHours", "null");
    expect(JSON.parse(chief("quiet")).hours).toBeNull();
  });
});

describe("通知的语言（config.json 的 locale）", () => {
  it("默认中文；改成 en 马上生效：攒下的提醒、钥匙、数据文件坏了、「最近做的」都是英文", () => {
    setConfig("quietHours", '{"start":"22:00","end":"08:00"}');
    holdIfQuiet("chief · x", "y", local(23, 23));
    holdIfQuiet("chief · z", "w", local(23, 23));
    const shown: [string, string][] = [];
    const show = (t: string, b: string) => void shown.push([t, b]);
    expect(msg().hubDownTitle).toBe("chief · 主会话没在听");
    expect(chief("config", "set", "locale", "en")).toMatch(/马上生效/);
    expect(flushHeld(local(24, 9), show)).toBe(2);
    expect(shown).toEqual([["chief · 2 notifications held during quiet hours", "x; z"]]);
    expect(msg().keyTitle).toBe('chief · The "send as you" key changed');
    expect(msg().corruptHealth("state.json", false, "/tmp/x")).toBe("state.json is broken (moved away, using defaults): copy at /tmp/x");
    recordSkip(new Date().toISOString(), [1, 2, 3]);
    recordDrop(new Date().toISOString(), { id: 1, title: "PROJ-123 load test" }, "doing");
    expect(loadUndo().items.map((x) => x.label)).toEqual(["Skipped 3 backlog messages", "Dropped: PROJ-123 load test"]);
    setConfig("locale", "zh");
    expect(msg().wokeTitle).toBe("chief · 稍后再说的事到点了");
  });
});

describe("每天汇总", () => {
  const times = { morning: "08:30", evening: "18:00" };

  it("到点发一次；同一天不再发", () => {
    expect(dueDigests(times, {}, local(23, 8, 29))).toEqual([]);
    expect(dueDigests(times, {}, local(23, 8, 31)).map((d) => [d.slot, d.date])).toEqual([["morning", "2026-11-23"]]);
    expect(dueDigests(times, { morning: "2026-11-23" }, local(23, 9))).toEqual([]);
    expect(dueDigests(times, { morning: "2026-11-23" }, local(23, 18, 1)).map((d) => d.slot)).toEqual(["evening"]);
  });

  it("睡过了点：3 小时内醒来补一次，再晚就不补", () => {
    expect(dueDigests(times, { morning: "2026-11-22" }, local(23, 11, 29)).map((d) => d.slot)).toEqual(["morning"]);
    expect(dueDigests(times, { morning: "2026-11-22" }, local(23, 11, 31))).toEqual([]);
    // 昨晚 23:00 的点，半夜 1 点醒来也补。
    expect(dueDigests({ morning: null, evening: "23:00" }, {}, local(24, 1)).map((d) => [d.slot, d.date])).toEqual([["evening", "2026-11-23"]]);
    expect(dueDigests({ morning: null, evening: "23:00" }, { evening: "2026-11-23" }, local(24, 1))).toEqual([]);
  });

  it("都没设：不发", () => {
    expect(dueDigests({ morning: null, evening: null }, {}, local(23, 12))).toEqual([]);
  });

  it("引擎到点交一条 digest 事件，记在 state 里，重启后不重复", () => {
    setConfig("digest.morning", "08:30");
    const e = new Engine();
    e.digestTick(local(23, 8, 40));
    e.digestTick(local(23, 8, 41));
    expect(readEvents().map((x) => [x.source, x.kind, x.why[0]])).toEqual([["chief", "digest", "morning"]]);
    expect(loadState().digest).toEqual({ morning: "2026-11-23" });
    new Engine().digestTick(local(23, 9));
    expect(readEvents()).toHaveLength(1);
    new Engine().digestTick(local(24, 8, 31));
    expect(readEvents()).toHaveLength(2);
  });

  it("chief digest：一次给全等你的、要你定的、待发出、上一份以后的变化、攒下的提醒", () => {
    const old = "2026-11-22T00:00:00.000Z";
    const mid = "2026-11-23T00:30:00.000Z";
    const late = "2026-11-23T01:00:00.000Z";
    appendEvent({ id: 1, at: old, source: "chief", kind: "digest", title: "早上的汇总", url: null, from: null, text: "", why: ["morning"], keys: [], reply: {} });
    appendEvent({ id: 2, at: mid, source: "slack", kind: "message.received", title: "私信", url: null, from: "Bob", text: "在吗", why: ["dm"], keys: ["slack:D1:1"], reply: {} });
    appendEvent({ id: 3, at: late, source: "chief", kind: "digest", title: "晚上的汇总", url: null, from: null, text: "", why: ["evening"], keys: [], reply: {} });
    writeJson(paths().things, {
      nextThing: 4, nextAsk: 2,
      things: [
        { id: 1, title: 'PROJ-123 压测', status: "waiting_you", progress: "报告好了", due: "2026-11-01", events: [2], updatedAt: mid, log: [{ at: mid, text: "报告好了" }] },
        { id: 2, title: "acme/shop#10 review", status: "doing", progress: "在看", blocker: "等 CI", events: [], updatedAt: old, log: [] },
        { id: 3, title: "旧事", status: "done", progress: "办完了", events: [], updatedAt: old, log: [] },
      ],
      asks: [{ id: 1, thing: 1, question: "压测报告能发给 Bob 吗", suggest: "发", status: "open", at: mid }],
    });
    writeJson(paths().replies, { nextId: 2, items: [{ id: 1, event: 2, source: "slack", target: {}, context: { who: "Bob", where: "私信", said: "在吗", url: null }, body: "在的", status: "pending", at: mid }] });
    writeJson(paths().held, { items: [{ at: mid, title: "chief · 回复没发出去", body: "x" }] });
    const m = digestMaterial({ event: 3, now: new Date("2026-11-23T01:00:30Z") });
    expect(m.since).toBe(old);
    expect(m.slot).toBe("evening");
    expect(m.counts).toMatchObject({ waitingYou: 1, doing: 1, asks: 1, outbox: 1, newEvents: 1, changed: 1, held: 1 });
    expect(m.waitingYou.map((x) => x.title)).toEqual(["PROJ-123 压测"]);
    expect(m.due.map((x) => x.id)).toEqual([1]);
    expect(m.blocked.map((x) => x.id)).toEqual([2]);
    expect(m.asks[0]).toMatchObject({ thing: "PROJ-123 压测", question: "压测报告能发给 Bob 吗" });
    expect(m.outbox[0]).toMatchObject({ who: "Bob", body: "在的" });
    expect(m.events.bySource).toEqual({ slack: 1 });
    // 不带 --event：从最近一份汇总算起。
    expect(digestMaterial().since).toBe(late);
    expect(JSON.parse(chief("digest", "--event", "3")).counts.asks).toBe(1);
  });
});

describe("导出", () => {
  function fill(ws: string) {
    writeJson(paths().policy, { notes: ["涉及排期的都要问我"] });
    writeJson(paths().config, { digest: { morning: "08:30" } });
    writeJson(paths().state, { nextId: 3 });
    writeFileSync(paths().events, '{"id":1}\n');
    writeFileSync(paths().confirmKey, "ab".repeat(32));
    writeFileSync(paths().keyLog, '{"what":"first"}\n');
    mkdirSync(paths().archive, { recursive: true });
    writeFileSync(join(paths().archive, "events-2026-10.jsonl"), '{"id":0}\n');
    mkdirSync(paths().slackState, { recursive: true });
    writeFileSync(join(paths().slackState, "cursor.json"), "{}");
    mkdirSync(join(ws, "notes"), { recursive: true });
    writeFileSync(join(ws, "CLAUDE.md"), "# 交代\n");
    writeFileSync(join(ws, "notes", "people.md"), "- bob.lee：后端\n");
    symlinkSync("/etc/hosts", join(ws, "notes", "link.md"));
  }

  it("带规矩、设置、数据、归档、交代、笔记；不带钥匙指纹、名字像密钥的、Slack 状态、链接", () => {
    const ws = realpathSync(mkdtempSync(join(tmpdir(), "chief-ws-")));
    fill(ws);
    const names = exportList(paths(), ws).map(([, to]) => to);
    expect(names).toEqual(expect.arrayContaining(["rules.json", "config.json", "data/state.json", "data/events.jsonl", "data/archive/events-2026-10.jsonl", "CLAUDE.md", "notes/people.md"]));
    expect(names.join(" ")).not.toMatch(/confirm-key|key-log|slack-state|link\.md/);
    expect(() => exportTo(join(h, "out"), { tar: false, workspace: ws })).toThrow(/数据目录/);
    const out = realpathSync(mkdtempSync(join(tmpdir(), "chief-out-")));
    const dir = exportTo(out, { tar: false, workspace: ws });
    expect(readFileSync(join(dir, "notes", "people.md"), "utf8")).toContain("bob.lee");
    expect(existsSync(join(dir, "data", "confirm-key.sha256"))).toBe(false);
    const gz = exportTo(join(out, "gz"), { tar: true, workspace: ws, now: new Date(2026, 0, 1) });
    expect(gz).toMatch(/chief-export-20260101-000000\.tar\.gz$/);
    const listed = execFileSync("/usr/bin/tar", ["-tzf", gz], { encoding: "utf8" });
    expect(listed).toContain("data/state.json");
    expect(listed).not.toContain("confirm-key");
    expect(existsSync(gz.replace(/\.tar\.gz$/, ""))).toBe(false);
  });

  it("chief export 默认放在 exports 下；CHIEF_HOME 在别处时不碰 ~/chief", () => {
    writeJson(paths().policy, { notes: [] });
    const out = chief("export");
    const path = /导出好了：(.+)/.exec(out)![1]!;
    expect(path.startsWith(join(h, "exports"))).toBe(true);
    expect(existsSync(path)).toBe(true);
    expect(execFileSync("/usr/bin/tar", ["-tzf", path], { encoding: "utf8" })).not.toMatch(/CLAUDE\.md|notes\//);
  });
});

describe("彻底删除", () => {
  // 假的主目录：~/chief/data 是默认位置。
  function fakeHome() {
    const user = realpathSync(mkdtempSync(join(tmpdir(), "chief-user-")));
    const ws = join(user, "chief");
    const data = join(ws, "data");
    mkdirSync(join(data, "bin"), { recursive: true });
    writeFileSync(join(data, "state.json"), "{}");
    writeFileSync(join(ws, "rules.json"), "{}");
    writeFileSync(join(ws, "CLAUDE.md"), "x");
    mkdirSync(join(ws, "notes"));
    mkdirSync(join(ws, "exports"));
    writeFileSync(join(ws, "exports", "chief-export-1.tar.gz"), "x");
    // 工作目录外面的东西：不能碰。
    mkdirSync(join(user, "dev"));
    writeFileSync(join(user, "dev", "keep.txt"), "x");
    return { user, ws, data };
  }

  it("只删数据目录和工作目录里的东西，留下 exports；钥匙串只删 chief 自己的", async () => {
    const { user, ws, data } = fakeHome();
    const plan = purgePlan(data, user);
    expect(plan.remove).toEqual([data, join(ws, "CLAUDE.md"), join(ws, "notes"), join(ws, "rules.json")]);
    expect(plan.keep).toEqual([join(ws, "exports")]);
    expect(plan.secrets).toEqual(expect.arrayContaining(["slack.cookie_d"]));
    const secrets = new MemorySecretStore();
    await secrets.set("slack.cookie_d", "xoxd-fake");
    await secrets.set("someone.else", "keep");
    const done = await runPurge(plan, data, user, secrets);
    expect(existsSync(data)).toBe(false);
    expect(existsSync(join(ws, "CLAUDE.md"))).toBe(false);
    expect(existsSync(join(ws, "exports", "chief-export-1.tar.gz"))).toBe(true);
    expect(existsSync(join(user, "dev", "keep.txt"))).toBe(true);
    expect(await secrets.has("slack.cookie_d")).toBe(false);
    expect(await secrets.has("someone.else")).toBe(true);
    expect(done).toContain("钥匙串 chief:slack.cookie_d");
  });

  it("没有导出的备份：工作目录整个删掉", async () => {
    const { user, ws, data } = fakeHome();
    execFileSync("/bin/rm", ["-r", join(ws, "exports")]);
    await runPurge(purgePlan(data, user), data, user, new MemorySecretStore());
    expect(existsSync(ws)).toBe(false);
    expect(existsSync(join(user, "dev", "keep.txt"))).toBe(true);
  });

  it("不对劲的路径一律不删：根目录、主目录、上层、链接、不像 chief 的目录", () => {
    const { user, data } = fakeHome();
    expect(checkTarget("/", user)).toMatch(/根目录/);
    expect(checkTarget("/tmp", user)).toMatch(/根目录/);
    expect(checkTarget(user, user)).toMatch(/主目录/);
    expect(checkTarget(resolve(user, ".."), user)).toMatch(/上层/);
    expect(checkTarget("chief/data", user)).toMatch(/绝对路径/);
    expect(() => purgePlan(user, user)).toThrow(/主目录/);
    const link = join(user, "link-data");
    symlinkSync(data, link);
    expect(() => purgePlan(link, user)).toThrow(/链接/);
    const other = join(user, "dev");
    expect(() => purgePlan(other, user)).toThrow(/不像 chief/);
    expect(existsSync(join(other, "keep.txt"))).toBe(true);
  });

  it("删的时候再对一遍：计划里混进别处的路径就停", async () => {
    const { user, data } = fakeHome();
    const plan = purgePlan(data, user);
    plan.remove.push(join(user, "dev"));
    await expect(runPurge(plan, data, user, new MemorySecretStore())).rejects.toThrow(/不在 chief 的目录里/);
    expect(existsSync(join(user, "dev", "keep.txt"))).toBe(true);
  });

  it("不在终端里跑（没有 TTY）：什么都不删", () => {
    writeJson(paths().state, { nextId: 1 });
    let err = "";
    try {
      chief("uninstall", "--purge");
    } catch (error) {
      err = String((error as { stderr?: string }).stderr);
    }
    expect(err).toMatch(/在终端里/);
    expect(existsSync(paths().state)).toBe(true);
  });
});
