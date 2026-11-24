// 数据文件的格式升级：每个文件记着自己的 version（writeJson 写的时候盖上，见 store.ts 的 SCHEMA），
// chief 每次起来（cli 的入口）把旧的一步一步升到现在的版本。没有 version 的是 0（加版本号之前的文件）。
// 每一步都要能重复跑（旧版 chief 写回去会把版本号盖回去，新版再跑一遍不能出错）。
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { CorruptFileError, SCHEMA, paths, readJson, withLock, writeJson } from "./store";

type Data = Record<string, unknown>;
type Step = (d: Data) => void;

const arr = (d: Data, k: string) => {
  if (!Array.isArray(d[k])) d[k] = [];
  return d[k] as Data[];
};
// 下一个编号：缺了就按已有的最大编号接着往下，不从 1 重来（重了会把两条回复、两件事搞混）。
const nextOf = (d: Data, k: string, items: Data[]) => {
  if (typeof d[k] !== "number") d[k] = Math.max(0, ...items.map((x) => (typeof x.id === "number" ? x.id : 0))) + 1;
};

// 第 i 步把版本 i 升到 i+1。版本 1 就是加版本号时的样子：缺的字段补上默认值（原来散在各个 load 里的那些）。
export const MIGRATIONS: Readonly<Record<string, readonly Step[]>> = {
  "state.json": [(d) => {
    for (const k of ["seen", "threads", "sent"]) arr(d, k);
    if (typeof d.nextId !== "number") d.nextId = 1;
    if (typeof d.since !== "object" || d.since === null) d.since = {};
  }],
  "replies.json": [(d) => nextOf(d, "nextId", arr(d, "items"))],
  "things.json": [(d) => {
    const things = arr(d, "things");
    nextOf(d, "nextThing", things);
    nextOf(d, "nextAsk", arr(d, "asks"));
    for (const t of things) {
      if (!Array.isArray(t.events)) t.events = [];
      if (!Array.isArray(t.log)) t.log = [];
    }
  }],
  // 规矩缺的东西 loadPolicy 读的时候按默认补（以后加的字段也是），这里只盖版本号。
  "rules.json": [() => {}],
  "evals.json": [(d) => {
    nextOf(d, "nextId", arr(d, "cases"));
    nextOf(d, "nextRun", arr(d, "runs"));
  }],
  "settings.json": [() => {}],
  "hub.json": [() => {}],
  "config.json": [() => {}],
  "undo.json": [(d) => nextOf(d, "nextId", arr(d, "items"))],
};

const files = () => {
  const p = paths();
  return [p.state, p.replies, p.things, p.policy, p.evals, p.settings, p.hub, p.config, p.undo];
};

// 升一个文件：返回升了没有。没有的、比现在新的（新版 chief 写的）不动。
export function migrateFile(file: string): boolean {
  const name = basename(file);
  const steps = MIGRATIONS[name];
  const target = SCHEMA[name];
  if (!steps || target === undefined || !existsSync(file)) return false;
  // config.json 是你手改的：写坏了不挪走，等你改好（config.ts 会报出来），这里跳过。
  if (name === "config.json") {
    try {
      JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return false;
    }
  }
  const behind = (d: Data | null): d is Data => d !== null && typeof d === "object" && !Array.isArray(d) && (typeof d.version === "number" ? d.version : 0) < target;
  // 先不拿锁看一眼：每条命令都跑这里，已经是新的就别去抢锁。
  if (!behind(readJson<Data | null>(file, null))) return false;
  return withLock(file, () => {
    const d = readJson<Data | null>(file, null);
    if (!behind(d)) return false;
    const from = typeof d.version === "number" ? d.version : 0;
    for (let v = from; v < target; v++) steps[v]!(d);
    d.version = target;
    writeJson(file, d);
    return true;
  });
}

// 全部升一遍，返回升了哪些。坏了的要紧文件这里跳过：真用到它的命令会报错（见 readJson）。
export function migrateAll(): string[] {
  const done: string[] = [];
  for (const f of files()) {
    try {
      if (migrateFile(f)) done.push(basename(f));
    } catch (error) {
      if (!(error instanceof CorruptFileError)) throw error;
    }
  }
  return done;
}
