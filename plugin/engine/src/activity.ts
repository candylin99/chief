// 子会话里的动静：你直接在 Claude App 的会话里推进了，不用它来汇报，面板也知道。
// Claude App 给每个本地会话存一条记录（~/Library/Application Support/Claude/claude-code-sessions/**/local_<编号>.json），
// 里面有最后活动时间、权限模式、对应的 Claude Code 会话编号；Claude Code 的对话记录在 ~/.claude/projects/<目录>/<编号>.jsonl。
// 这里只读不写，结果记在 ~/chief/data/activity.json（引擎自己写），面板读它。
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadThings, paths, readJson, writeJson } from "./store";

export interface SessionActivity {
  // 对话记录的大小（变了就重读）。
  size?: number;
  // 会话最后一次有动静的时间（收到消息也算）。
  at: string;
  // 会话最后一次说话（last 那段话）的时间：判断「会话说的」和「主会话记的」谁新，看这个。
  saidAt: string | null;
  // 会话弹了问你的对话框、还没回答：问的是什么（没有就是 null）。
  waiting: string | null;
  title: string;
  // 会话最后说的一段话（截短）。
  last: string;
  permissionMode: string | null;
  archived: boolean;
}

const SESSION_ID = /^local_[A-Za-z0-9-]{1,100}$/;
const TAIL_BYTES = 256 * 1024;

export function sessionsRoot(): string {
  return join(homedir(), "Library", "Application Support", "Claude", "claude-code-sessions");
}

// local_<编号>.json 在两层目录下（账号 / 组织），找一次记住。
const where = new Map<string, string>();

function recordPath(id: string): string | null {
  const hit = where.get(id);
  if (hit && existsSync(hit)) return hit;
  const root = sessionsRoot();
  if (!existsSync(root)) return null;
  for (const a of readdirSync(root)) {
    const da = join(root, a);
    if (!statSync(da).isDirectory()) continue;
    for (const b of readdirSync(da)) {
      const file = join(da, b, `${id}.json`);
      if (existsSync(file)) {
        where.set(id, file);
        return file;
      }
    }
  }
  return null;
}

type Part = { type?: string; text?: string; name?: string; id?: string; tool_use_id?: string; input?: { questions?: { question?: string }[]; title?: string; description?: string } };
// 你打的话 content 是一段字符串；助手说的、工具结果是一串 Part。
type Line = { type?: string; timestamp?: string; message?: { content?: string | Part[] } };

function parts(l: Line): Part[] {
  const c = l.message?.content;
  return Array.isArray(c) ? c : [];
}

function transcriptPath(cwd: string, cliSessionId: string): string {
  return join(homedir(), ".claude", "projects", cwd.replace(/[^A-Za-z0-9]/g, "-"), `${cliSessionId}.jsonl`);
}

// 对话记录有多大、最后改的时间：会话卡在弹框上时 App 的会话记录不变，但对话记录会多出那一步，靠大小知道要重读；
// 改的时间用来看它停了多久。
function transcriptStat(cwd: string, cliSessionId: string): { size: number; mtime: number } {
  const file = transcriptPath(cwd, cliSessionId);
  if (!existsSync(file)) return { size: 0, mtime: 0 };
  const st = statSync(file);
  return { size: st.size, mtime: st.mtimeMs };
}

function tailLines(cwd: string, cliSessionId: string): Line[] {
  const file = transcriptPath(cwd, cliSessionId);
  if (!existsSync(file)) return [];
  const size = statSync(file).size;
  const len = Math.min(size, TAIL_BYTES);
  const buf = Buffer.alloc(len);
  const fd = openSync(file, "r");
  readSync(fd, buf, 0, len, size - len);
  closeSync(fd);
  return buf.toString("utf8").split("\n").flatMap((l) => {
    try {
      return l.trim() ? [JSON.parse(l) as Line] : [];
    } catch {
      return [];
    }
  });
}

// 会话是不是停在问你的对话框上：最后一个「问你」（AskUserQuestion）还没有回答。返回问题。
// 就算是 bypass 模式，App 也会弹框等你点 Allow 的工具：开新会话。
const NEEDS_ALLOW = new Set(["mcp__ccd_session__start_session"]);

export function waitingQuestion(lines: Line[]): string | null {
  const answered = new Set<string>();
  const allow: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    for (const c of parts(lines[i]!)) {
      if (c.type === "tool_result" && c.tool_use_id) answered.add(c.tool_use_id);
      if (c.type !== "tool_use" || lines[i]!.type !== "assistant" || !c.id || answered.has(c.id)) continue;
      if (c.name === "AskUserQuestion") {
        return (c.input?.questions ?? []).map((q) => q.question ?? "").filter(Boolean).join("；").slice(0, 400) || "（它在等你回答）";
      }
      if (NEEDS_ALLOW.has(c.name ?? "")) allow.push(`「${(c.input?.title ?? "新会话").slice(0, 40)}」`);
    }
    // 往前读到一段已经答完的对话就停：再往前的早就过去了。
    if (lines[i]!.type === "user" && allow.length === 0 && answered.size > 0) break;
  }
  if (allow.length > 0) return `它要开新会话 ${allow.reverse().join("、")}，在等你点 Allow（App 每个都要你点）`;
  return null;
}

// 对话记录的最后一段：从文件尾往前读，找最后一条助手说的文字和它的时间。
function lastAssistantText(cwd: string, cliSessionId: string): { text: string; at: string | null } {
  const lines = tailLines(cwd, cliSessionId);
  for (let i = lines.length - 1; i >= 0; i--) {
    const j = lines[i]!;
    if (j.type !== "assistant") continue;
    const text = parts(j).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n").trim();
    if (text) return { text: text.replace(/[ \t]+/g, " ").slice(0, 1200), at: j.timestamp ?? null };
  }
  return { text: "", at: null };
}

export interface SessionUpdate {
  thing: number;
  title: string;
  session: string;
  at: string;
  last: string;
  // 会话最后的话像是在问你、等你定。
  asking: boolean;
  // 会话弹了问你的对话框（问的是什么）。
  waiting?: string;
}

// 像是在等你拍板的话：问句、要不要、你定、确认……
const ASKING = /[?？]|要不要|是否|需要你|等你|你来定|你决定|你确认|拍板|选哪|同意吗|可以吗|行吗|回我/;

// 主会话（标题「chief 消息中心」、最近动过的那个）是什么权限模式：和工作会话不是同一类时，主会话发过去的消息会被扣住。
export function hubPermissionMode(): string | null {
  const root = sessionsRoot();
  if (!existsSync(root)) return null;
  let best: { at: number; mode: string | null } | null = null;
  for (const a of readdirSync(root)) {
    const da = join(root, a);
    if (!statSync(da).isDirectory()) continue;
    for (const b of readdirSync(da)) {
      const db = join(da, b);
      if (!statSync(db).isDirectory()) continue;
      for (const f of readdirSync(db)) {
        if (!f.startsWith("local_") || !f.endsWith(".json")) continue;
        try {
          const rec = JSON.parse(readFileSync(join(db, f), "utf8")) as { title?: string; lastActivityAt?: number; permissionMode?: string; isArchived?: boolean };
          if (rec.title !== "chief 消息中心" || rec.isArchived) continue;
          const at = rec.lastActivityAt ?? 0;
          if (!best || at > best.at) best = { at, mode: rec.permissionMode ?? null };
        } catch {
          // 读不了的跳过。
        }
      }
    }
  }
  return best?.mode ?? null;
}

// 扫一遍事情清单里挂着会话的事，记下各会话的动静。返回有新进展的会话（最后的话变了的）。
export function syncActivity(): SessionUpdate[] {
  const things = loadThings().things.filter((t) => t.session && SESSION_ID.test(t.session) && t.status !== "done" && t.status !== "dropped");
  const before = readJson<Record<string, SessionActivity>>(paths().activity, {});
  const next: Record<string, SessionActivity> = {};
  const updates: SessionUpdate[] = [];
  for (const t of things) {
    const id = t.session!;
    const file = recordPath(id);
    if (!file) continue;
    let rec: { lastActivityAt?: number; cliSessionId?: string; lastAssistantCliSessionId?: string; cwd?: string; title?: string; permissionMode?: string; isArchived?: boolean };
    try {
      rec = JSON.parse(readFileSync(file, "utf8")) as typeof rec;
    } catch {
      continue;
    }
    const at = rec.lastActivityAt ? new Date(rec.lastActivityAt).toISOString() : null;
    if (!at) continue;
    const old = id === "_hub" ? undefined : before[id];
    const cli = rec.lastAssistantCliSessionId ?? rec.cliSessionId;
    const { size } = cli && rec.cwd ? transcriptStat(rec.cwd, cli) : { size: 0 };
    // 旧版记过 stuck（按「工具几分钟没结果」猜的等你点，已经不猜了）：重读一遍，别把旧的误报留着。
    const same = old !== undefined && old.at === at && old.size === size && !("stuck" in old);
    const said = same ? { text: old.last, at: old.saidAt ?? null } : cli && rec.cwd ? lastAssistantText(rec.cwd, cli) : { text: "", at: null };
    const lines = same || !cli || !rec.cwd ? null : tailLines(rec.cwd, cli);
    // 只认会话真的停在你面前的框：问你的问题（AskUserQuestion）、开新会话等你点 Allow。
    // 别的要你拍板的，由会话自己发「chief 要你定」给主会话，不从「命令多久没结果」去猜。
    const waiting = lines ? waitingQuestion(lines) : old?.waiting ?? null;
    next[id] = {
      at, size, saidAt: said.at, waiting, title: rec.title ?? "", permissionMode: rec.permissionMode ?? null, archived: rec.isArchived === true,
      last: said.text,
    };
    // 刚开始等你回答：马上交出去（不管上面那段话有没有变）。
    if (waiting && waiting !== old?.waiting && old !== undefined) {
      updates.push({ thing: t.id, title: t.title, session: id, at, last: `会话在等你回答：${waiting}`, asking: true, waiting });
      continue;
    }
    const now = next[id]!;
    if (!same && now.last && now.last !== old?.last && old !== undefined) {
      updates.push({ thing: t.id, title: t.title, session: id, at: now.saidAt ?? at, last: now.last, asking: ASKING.test(now.last) });
    }
  }
  // 主会话的权限模式也记在这里（键是 _hub），面板拿它判断会不会被扣住。
  const hubMode = hubPermissionMode();
  const all: Record<string, unknown> = { ...next, _hub: { permissionMode: hubMode } };
  const prevHub = (before as Record<string, unknown>)._hub as { permissionMode?: string | null } | undefined;
  if (updates.length > 0 || JSON.stringify(next) !== JSON.stringify({ ...before, _hub: undefined }) || prevHub?.permissionMode !== hubMode) writeJson(paths().activity, all);
  return updates;
}
