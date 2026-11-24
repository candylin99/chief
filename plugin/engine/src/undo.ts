// 能撤回的操作：事情标成不做了、主会话把消息判断成只记下 / 忽略、跳过积下的旧消息。
// 做的时候往 undo.json 记一笔（撤回要用的原样：事情原来的状态、每条消息原来怎么处理的），只留最近 MAX_UNDO 笔。
// chief undo 照原样改回去，再交给主会话一条 chief.undo：撤回的消息重新算没判断，要它重新办；撤回的「不做了」要它告诉会话接着做。
import { readLines, rewriteLines } from "./archive";
import { msg } from "./messages";
import { addEvent, loadDispatch, paths, readEvents, readJson, updateJson, withLock, type ChiefEvent, type Decision, type Dispatch, type Thing, type ThingsFile, type UndoEntry, type UndoFile } from "./store";

export const MAX_UNDO = 50;

const EMPTY: UndoFile = { nextId: 1, items: [] };

export function loadUndo(): UndoFile {
  return readJson<UndoFile>(paths().undo, { ...EMPTY, items: [] });
}

export function updateUndo<T>(fn: (u: UndoFile) => T): T {
  return updateJson<UndoFile, T>(paths().undo, { ...EMPTY, items: [] }, fn);
}

export function recordUndo(e: Omit<UndoEntry, "id">): number {
  return updateUndo((u) => {
    const id = u.nextId++;
    u.items = [...u.items, { id, ...e }].slice(-MAX_UNDO);
    return id;
  });
}

const verbOf = (v: Decision["verdict"]): string | undefined => (v === "ignored" ? msg().undoIgnored : v === "noted" ? msg().undoNoted : undefined);

// 一条消息给人看的样子：在哪、谁说的。
const where = (e: ChiefEvent) => (e.from ? msg().undoFrom(e.title, e.from) : e.title).slice(0, 60);

// 主会话 chief mark 了几条消息：只记下、忽略的能撤（派出去的已经送进会话了，撤了也收不回来）。演练、chief 自己的提醒不记。
export function recordMark(verdict: Decision["verdict"], at: string, events: ChiefEvent[], before: Record<string, Dispatch>, thing: number | null): void {
  const verb = verbOf(verdict);
  const real = events.filter((e) => !e.dryrun && !e.kind.startsWith("chief."));
  if (!verb || real.length === 0) return;
  recordUndo({
    at, kind: "mark",
    label: msg().undoMark(verb, where(real[0]!), real.length),
    events: real.map((e) => ({ id: e.id, before: before[e.id] ?? null })),
    ...(thing !== null ? { addedTo: { thing, events: real.map((e) => e.id) } } : {}),
  });
}

export function recordSkip(at: string, ids: number[]): void {
  if (ids.length === 0) return;
  recordUndo({ at, kind: "skip", label: msg().undoSkip(ids.length), events: ids.map((id) => ({ id, before: null })) });
}

export function recordDrop(at: string, thing: Pick<Thing, "id" | "title">, status: Thing["status"]): void {
  recordUndo({ at, kind: "drop", label: msg().undoDrop(thing.title), thing: { id: thing.id, status } });
}

const EMPTY_THINGS: ThingsFile = { nextThing: 1, nextAsk: 1, things: [], asks: [] };

// 撤回一笔，返回一句给人看的话。撤不回（后来又动过、已经归档）就 throw。
export function undoEntry(entry: UndoEntry, now = new Date()): string {
  if (entry.undone) throw new Error("这一笔已经撤回过了");
  const at = now.toISOString();
  let said: string;
  if (entry.kind === "drop") said = undoDrop(entry, at);
  else said = undoMarks(entry, at);
  updateUndo((u) => {
    const x = u.items.find((y) => y.id === entry.id);
    if (x) x.undone = at;
  });
  return said;
}

function undoDrop(entry: UndoEntry, at: string): string {
  const want = entry.thing ?? (() => {
    throw new Error("撤回记录缺了事情");
  })();
  const t = updateJson<ThingsFile, Thing>(paths().things, { ...EMPTY_THINGS, things: [], asks: [] }, (all) => {
    const x = all.things.find((y) => y.id === want.id);
    if (!x) throw new Error("这件事已经归档了，撤不回");
    if (x.status !== "dropped") throw new Error("这件事现在不是「不做了」，不用撤");
    x.status = want.status;
    x.updatedAt = at;
    // 标成不做了时一起撤掉的问题（closedAt 就是那一下）：拿回来接着等你定。
    for (const a of all.asks) {
      if (a.thing !== x.id || a.status !== "withdrawn" || a.closedAt !== entry.at) continue;
      a.status = "open";
      delete a.reason;
      delete a.closedAt;
    }
    x.log = [...x.log, { at, text: "你撤回了「不做了」，接着做" }].slice(-30);
    return { ...x };
  });
  addEvent({
    at, source: "session", kind: "chief.undo", title: `撤回了不做了：${t.title}`.slice(0, 200), url: null, from: "你",
    text: `用户撤回了「不做了」：事情 #${t.id}「${t.title}」接着做（状态回到 ${t.status}）。${t.session ? `之前让会话 ${t.session} 停下了，用 send_message 告诉它接着做。` : "它没有会话，记一笔就行。"}这条 mark noted --thing ${t.id}。`,
    why: ["undo"], keys: [...(t.keys ?? []), ...(t.session ? [t.session] : [])], reply: {},
  });
  return `「${t.title}」接着做了，已告诉主会话`;
}

function undoMarks(entry: UndoEntry, at: string): string {
  const list = entry.events ?? [];
  const present = new Map(readEvents().map((e) => [e.id, e]));
  // 只改回这一笔记下的：后来又判断过（at 对不上）、已经归档的不动。
  const back = updateJson<Record<string, Dispatch>, number[]>(paths().dispatch, {}, (d) => {
    const out: number[] = [];
    for (const { id, before } of list) {
      if (!present.has(id) || d[id]?.at !== entry.at) continue;
      if (before) d[id] = before;
      else delete d[id];
      out.push(id);
    }
    return out;
  });
  if (back.length === 0) throw new Error("这些消息后来又判断过了，或者已经归档了，撤不回");
  const ids = new Set(back);
  // 这一笔记下的判断（为什么这么办）一起拿掉：测评不再算它。
  withLock(paths().decisions, () => {
    const all = readLines<Decision>(paths().decisions);
    const left = all.filter((d) => !(d.at === entry.at && ids.has(d.event)));
    if (left.length !== all.length) rewriteLines(paths().decisions, left);
  });
  if (entry.addedTo) {
    const added = new Set(entry.addedTo.events.filter((id) => ids.has(id)));
    updateJson<ThingsFile, void>(paths().things, { ...EMPTY_THINGS, things: [], asks: [] }, (all) => {
      const x = all.things.find((y) => y.id === entry.addedTo!.thing);
      if (x) x.events = x.events.filter((id) => !added.has(id));
    });
  }
  // 原来没判断的才重新交给主会话；原来有判断的（--force 改判断）改回原来的判断就好。
  const handled = loadDispatch();
  const reopened = back.filter((id) => !handled[id]).sort((a, b) => a - b);
  if (reopened.length > 0) {
    const first = present.get(reopened[0]!)!;
    const text = entry.kind === "skip"
      ? `用户撤回了「跳过积下的旧消息」：${reopened.length} 条消息重新算没判断（#${reopened[0]} 到 #${reopened.at(-1)}）。用 chief events --after ${reopened[0]! - 1} 打出来（只打没判断的），照平常的办法一条条判断、mark，再 chief cursor；这条提醒 mark noted。`
      : `用户撤回了你对 ${reopened.length} 条消息的判断（${entry.label.split(/：|: /)[0]}）：${reopened.map((id) => `#${id}`).join("、")} 重新算没判断，用户多半觉得不该这么办。chief show 看原文，照平常的办法重新判断、mark；这条提醒也 mark noted。`;
    addEvent({
      at, source: first.source, kind: "chief.undo", title: `撤回了判断：${entry.label}`.slice(0, 200), url: reopened.length === 1 ? first.url : null, from: "你",
      text, why: ["undo"], keys: reopened.length === 1 ? first.keys : [], reply: {},
    });
  }
  return entry.kind === "skip" ? `${back.length} 条旧消息重新交给主会话了` : `撤回了「${entry.label}」，重新交给主会话判断`;
}
