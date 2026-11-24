// 试一下、演练：chief test 造一条测试消息；chief eval 拿例子测主会话会怎么办（不真的办），对结果。
import { fail, flag, num, oneLine, stdinText } from "../args";
import { keysOf } from "../keys";
import { EXPECT_LABELS } from "../shared/rules";
import { appendEvent, expectOf, loadDecisions, loadState, paths, readJson, saveState, updateJson, withLock, type ChiefEvent, type EvalCase, type EvalRun, type EvalsFile, type Expect } from "../store";
import { eventById } from "./events";

// chief test [--from 名字] [--where 位置] [--why dm|mention|thread]（标准输入给消息内容）：
// 造一条「有人找你」的消息，走一遍主会话的判断、派活、回复。回复会进待发出，但发不出去（标着测试）。
export async function testEvent(args: string[]): Promise<void> {
  const from = oneLine(flag(args, "--from") ?? "测试同事", 40);
  const where = oneLine(flag(args, "--where") ?? "测试私信", 60);
  const why = flag(args, "--why") ?? "dm";
  if (!["dm", "mention", "thread"].includes(why)) fail("--why 是 dm|mention|thread 之一");
  const text = await stdinText();
  if (!text) fail("从标准输入给消息内容");
  const id = withLock(paths().state, () => {
    const st = loadState();
    const e: ChiefEvent = {
      id: st.nextId++, at: new Date().toISOString(), source: "slack", kind: "message.received", title: `[测试] ${where}`, url: null, from,
      text, why: [why], keys: [`test:${Date.now()}`, ...keysOf(text)], reply: {}, test: true,
    };
    saveState(st);
    appendEvent(e);
    return e.id;
  });
  process.stdout.write(`造了测试消息 #${id}，主会话在听的话马上会处理\n`);
}

export const EXPECTS: Readonly<Record<Expect, string>> = EXPECT_LABELS;

export const EMPTY_EVALS: EvalsFile = { nextId: 1, nextRun: 1, cases: [], runs: [] };

export function updateEvals<T>(fn: (e: EvalsFile) => T): T {
  return updateJson<EvalsFile, T>(paths().evals, { ...EMPTY_EVALS, cases: [], runs: [] }, fn);
}

// chief eval add（标准输入 JSON：{from, where, why, text, expect, note}）| from-event <事件号> [expect] | list | remove <号> | run | report
export async function evals(args: string[]): Promise<void> {
  const sub = args.shift();
  if (sub === "add") {
    let c: Partial<EvalCase>;
    try {
      c = JSON.parse(await stdinText()) as Partial<EvalCase>;
    } catch {
      fail('标准输入要是 JSON：{"from","where","why","text","expect":"dispatch|note|ignore|ask","note"}');
    }
    if (typeof c.text !== "string" || !c.text.trim()) fail("text 不能空");
    if (!c.expect || !(c.expect in EXPECTS)) fail(`expect 是 ${Object.keys(EXPECTS).join("|")} 之一`);
    const x = { from: oneLine(c.from ?? "同事", 40), where: oneLine(c.where ?? "私信", 60), why: ["dm", "mention", "thread", "self"].includes(c.why ?? "") ? c.why! : "dm", text: c.text.trim().slice(0, 2000), expect: c.expect, ...(c.note ? { note: oneLine(c.note, 300) } : {}) };
    const id = updateEvals((e) => {
      const y: EvalCase = { id: e.nextId++, ...x, at: new Date().toISOString() };
      e.cases.push(y);
      return y.id;
    });
    process.stdout.write(`加好了：例子 ${id}\n`);
    return;
  }
  // 把一条真实判断存成例子：默认「应该怎么办」就是当时的判断（你标过对的那种）；也可以写明应该怎么办。
  if (sub === "from-event") {
    const ev = eventById(num(args.shift(), "事件号"));
    const d = [...loadDecisions()].reverse().find((x) => x.event === ev.id && !x.dry);
    const want = (args.shift() as Expect | undefined) ?? (d ? expectOf(d.verdict) : undefined);
    if (!want || !(want in EXPECTS)) fail(`这条还没判断过：写明应该怎么办（${Object.keys(EXPECTS).join("|")}）`);
    const id = updateEvals((e) => {
      const y: EvalCase = { id: e.nextId++, from: ev.from ?? "同事", where: ev.title, why: ev.why[0] ?? "dm", text: ev.text, expect: want, fromEvent: ev.id, at: new Date().toISOString() };
      e.cases.push(y);
      return y.id;
    });
    process.stdout.write(`存成例子 ${id}（应该：${EXPECTS[want]}）\n`);
    return;
  }
  if (sub === "list") {
    process.stdout.write(`${JSON.stringify(readJson<EvalsFile>(paths().evals, EMPTY_EVALS).cases, null, 2)}\n`);
    return;
  }
  if (sub === "remove") {
    const id = num(args.shift(), "例子号");
    updateEvals((e) => {
      e.cases = e.cases.filter((c) => c.id !== id);
    });
    return;
  }
  // 跑一遍：每个例子造一条演练消息交给主会话（它只判断、说会怎么办，什么都不真的做）。
  if (sub === "run") {
    const cases = readJson<EvalsFile>(paths().evals, EMPTY_EVALS).cases;
    if (cases.length === 0) fail("还没有例子：chief eval add，或者在测评页把判断记录存成例子");
    const events: Record<string, number> = {};
    for (const c of cases) {
      events[c.id] = withLock(paths().state, () => {
        const st = loadState();
        const e: ChiefEvent = {
          id: st.nextId++, at: new Date().toISOString(), source: "slack", kind: "message.received", title: `[演练] ${c.where}`, url: null, from: c.from,
          text: c.text, why: [c.why], keys: [`eval:${c.id}:${Date.now()}`, ...keysOf(c.text)], reply: {}, test: true, dryrun: true, eval: c.id,
        };
        saveState(st);
        appendEvent(e);
        return e.id;
      });
    }
    const runId = updateEvals((e) => {
      const r: EvalRun = { id: e.nextRun++, at: new Date().toISOString(), events };
      e.runs = [...e.runs, r].slice(-20);
      return r.id;
    });
    process.stdout.write(`第 ${runId} 次演练：交了 ${cases.length} 个例子给主会话，判断完用 chief eval report 看结果\n`);
    return;
  }
  // 对结果：每个例子，主会话这次判断成什么、对不对、为什么。
  if (sub === "report") {
    const e = readJson<EvalsFile>(paths().evals, EMPTY_EVALS);
    const run = e.runs.at(-1) ?? fail("还没跑过：chief eval run");
    const decisions = loadDecisions();
    const results = e.cases.filter((c) => run.events[c.id] !== undefined).map((c) => {
      const d = [...decisions].reverse().find((x) => x.event === run.events[c.id]);
      const got = d ? expectOf(d.verdict) : null;
      return { case: c.id, text: oneLine(c.text, 80), expect: c.expect, got, ok: got === null ? null : got === c.expect, reason: d?.reason ?? null };
    });
    const done = results.filter((r) => r.got !== null);
    process.stdout.write(`${JSON.stringify({ run: run.id, at: run.at, total: results.length, judged: done.length, correct: done.filter((r) => r.ok).length, results }, null, 2)}\n`);
    return;
  }
  fail("chief eval add|from-event|list|remove|run|report");
}
