// 命令行的小工具：读参数、读标准输入、报错退出、检查写给用户看的字。cli.ts 和 commands/*.ts 都用。
// 从标准输入给的文字（理由、进展、问题、稿子）不经过命令行参数：里面会引用别人的原文，不能让 shell 当成命令。
import { chiefIds, idsMessage, type IdsOptions } from "./plain";

// 会话编号。
export const SESSION = /^[\w-]{1,100}$/;
// 从标准输入给的一段话最多这么长。
export const MAX_TEXT = 2000;

export function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

export function oops(message: string): never {
  throw new Error(message);
}

export function flag(args: string[], name: string): string | null {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--")) fail(`${name} 后面要跟一个值`);
  args.splice(i, 2);
  return v;
}

// 能写好几次的参数（--image a.png --image b.png）：按顺序全拿出来。
export function flags(args: string[], name: string): string[] {
  const out: string[] = [];
  for (let v = flag(args, name); v !== null; v = flag(args, name)) out.push(v);
  return out;
}

export function num(text: string | undefined, what: string): number {
  if (!text || !/^\d{1,9}$/.test(text)) fail(`${what}要是数字`);
  return Number(text);
}

// 标题由主会话自己写（一句话说清这件事），只许这些字符：主会话按规矩用单引号包起来传参，
// 这里再挡一道，免得别人的原文被抄进命令行参数里。
// 英文标题常用的撇号只认弯的 ’（直的 ' 会把单引号包着的参数断开），另加 & 和长短破折号。
export const TITLE_OK = /^[\p{L}\p{N} #._:/()（）·、，,+\-’&–—]{1,120}$/u;

export function title(text: string | null): string | null {
  if (text === null) return null;
  const t = text.trim();
  if (!TITLE_OK.test(t)) fail("标题只能用字、数字、空格和 # . _ : / ( ) · 、， , + - ’ & – —（英文的撇号用 ’，不用 '），由你自己概括，不要抄对方原文");
  return t;
}

// 给用户看的话里有 chief 自己的编号（#98、问题 #63、回复 107）就拒收，告诉写的人改成一句话说清是哪一条。见 plain.ts。
export function plainOnly(text: string | null | undefined, what: string, opts: IdsOptions = {}, hint = ""): void {
  if (!text) return;
  const ids = chiefIds(text, opts);
  if (ids.length > 0) fail(idsMessage(what, ids, hint));
}

export function oneLine(text: string, max = 200): string {
  return text.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

// 主会话写的话（进展、问题、回答）从标准输入读：里面会引用别人的原文，不放进命令行参数，免得被 shell 当成命令。
export async function stdinText(): Promise<string> {
  return (await stdinRaw()).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim().slice(0, MAX_TEXT);
}

// 标准输入原样读进来（最多 max 个字）。
export async function stdinRaw(max = Infinity): Promise<string> {
  if (process.stdin.isTTY) return "";
  let data = "";
  for await (const chunk of process.stdin) {
    data += String(chunk);
    if (data.length > max) fail("标准输入太长了");
  }
  return data;
}
