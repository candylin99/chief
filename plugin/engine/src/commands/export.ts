// 导出和彻底删除：chief export / chief uninstall --purge。
// 导出只带你的东西（规矩、设置、交代、笔记、数据文件、归档），不带密钥：钥匙串里的不碰，「以你的名义发」的钥匙指纹、名字像密钥的文件都跳过。
// 彻底删除只删认得的几个位置（数据目录、工作目录），删之前每个都对一遍：不是 /、不是你的主目录或它的上层、不是链接、在该在的地方。
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fail, flag } from "../args";
import type { SecretStore } from "../secrets";
import { defaultHomeOf, workspaceOf } from "../shared/paths";
import { DESCRIPTORS } from "../sources/registry";
import { paths, workspaceDir } from "../store";

// 名字像密钥的文件一律不导出（confirm-key.sha256、key-log.jsonl 也在里面）。
const SECRETISH = /key|secret|token|cookie|credential|password|\.pem$|\.p12$/i;

function isFile(p: string): boolean {
  try {
    return lstatSync(p).isFile();
  } catch {
    return false;
  }
}

function isDir(p: string): boolean {
  try {
    return lstatSync(p).isDirectory();
  } catch {
    return false;
  }
}

// 工作目录 ~/chief 只在数据目录是默认的（~/chief/data）时算 chief 的；CHIEF_HOME 指到别处（测试）时不碰它。
export function chiefWorkspace(): string | null {
  return resolve(paths().home) === defaultHomeOf(homedir()) ? workspaceDir() : null;
}

// 要导出的：[原路径, 导出里的相对路径]。只拿普通文件（链接不跟），目录只拿 notes/ 和 data/archive/。
export function exportList(p = paths(), workspace: string | null = chiefWorkspace()): [string, string][] {
  const out: [string, string][] = [];
  const add = (from: string, to: string) => {
    if (isFile(from) && !SECRETISH.test(basename(from))) out.push([from, to]);
  };
  add(p.policy, "rules.json");
  add(p.config, "config.json");
  for (const f of isDir(p.home) ? readdirSync(p.home).sort() : []) {
    if (/\.jsonl?$/.test(f) && f !== basename(p.confirmKey)) add(join(p.home, f), join("data", f));
  }
  for (const f of isDir(p.archive) ? readdirSync(p.archive).sort() : []) add(join(p.archive, f), join("data", "archive", f));
  if (workspace !== null && isDir(workspace)) {
    add(join(workspace, "CLAUDE.md"), "CLAUDE.md");
    const walk = (dir: string, rel: string) => {
      for (const f of readdirSync(dir).sort()) {
        const from = join(dir, f);
        if (isDir(from)) walk(from, join(rel, f));
        else add(from, join(rel, f));
      }
    };
    if (isDir(join(workspace, "notes"))) walk(join(workspace, "notes"), "notes");
  }
  return out;
}

function stamp(d = new Date()): string {
  const z = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}

// 导出到 out 目录下的 chief-export-<时间>/，有 tar 就打成 .tar.gz（打好删掉文件夹）。返回导出的路径。
export function exportTo(outDir: string, opts: { tar?: boolean; workspace?: string | null; now?: Date } = {}): string {
  const out = resolve(outDir);
  const home = resolve(paths().home);
  // 别导出进数据目录（下次导出会把上次的又装进去）；默认的 exports 目录除外（数据目录就是工作目录时它在里面，导出不会进去拿）。
  if ((out === home || out.startsWith(`${home}${sep}`)) && out !== resolve(paths().exports)) throw new Error(`别导出到数据目录 ${home} 里面`);
  mkdirSync(out, { recursive: true, mode: 0o700 });
  const name = `chief-export-${stamp(opts.now)}`;
  const dir = join(out, name);
  if (existsSync(dir) || existsSync(`${dir}.tar.gz`)) throw new Error(`${dir} 已经有了，过一秒再试`);
  mkdirSync(dir, { mode: 0o700 });
  for (const [from, to] of exportList(paths(), opts.workspace === undefined ? chiefWorkspace() : opts.workspace)) {
    mkdirSync(dirname(join(dir, to)), { recursive: true, mode: 0o700 });
    cpSync(from, join(dir, to));
  }
  const tar = opts.tar ?? existsSync("/usr/bin/tar");
  if (!tar) return dir;
  execFileSync("/usr/bin/tar", ["-czf", `${name}.tar.gz`, name], { cwd: out, stdio: "ignore" });
  // 只删刚建的这个文件夹（就在 out 下面、名字是刚起的）。
  rmSync(dir, { recursive: true });
  return `${dir}.tar.gz`;
}

// chief export [--out <目录>]：默认放在 ~/chief/exports。
export function exportCmd(args: string[]): void {
  const out = flag(args, "--out");
  if (out !== null && out.trim() === "") fail("--out 后面给一个目录");
  try {
    const path = exportTo(out ?? paths().exports);
    process.stdout.write(`导出好了：${path}\n（不含密钥：钥匙串里的 Slack Cookie、Notion 令牌和「以你的名义发」的钥匙都不在里面）\n`);
  } catch (error) {
    fail(`导出没成：${error instanceof Error ? error.message : String(error)}`);
  }
}

// ── 彻底删除 ──

export interface PurgePlan {
  // 要整个删掉的目录。
  remove: string[];
  // 工作目录里留着不删的（你导出的备份）。
  keep: string[];
  // 钥匙串里要删的名字。
  secrets: string[];
}

// 对一遍要删的路径：绝对路径、至少两层（不删 /tmp 这种）、不是主目录也不是它的上层、路径里没有链接（真实路径就是它自己）。
export function checkTarget(p: string, userHome: string): string | null {
  if (!isAbsolute(p)) return `${p} 不是绝对路径`;
  const r = resolve(p);
  const home = resolve(userHome);
  if (r.split(sep).filter(Boolean).length < 2 || r === home || !relative(r, home).startsWith("..")) return `${r} 是根目录、主目录或它的上层，不删`;
  if (!existsSync(r)) return null;
  if (realpathSync(r) !== r) return `${r} 的路径里有链接（实际在 ${realpathSync(r)}），chief 不跟着删，自己看着删`;
  return null;
}

// 算出要删什么。数据目录是默认的（~/chief/data）才连工作目录 ~/chief 一起删；用 CHIEF_HOME 指到别处的，只删那个数据目录，
// 而且它得像 chief 的数据目录（有 state.json、events.jsonl 或 bin/chief）。
export function purgePlan(home: string, userHome: string): PurgePlan {
  const data = resolve(home);
  const ws = workspaceOf(resolve(userHome));
  const isDefault = data === defaultHomeOf(resolve(userHome));
  const problems = [checkTarget(data, userHome), ...(isDefault ? [checkTarget(ws, userHome)] : [])].filter((x): x is string => x !== null);
  if (problems.length > 0) throw new Error(problems.join("；"));
  if (!isDefault && existsSync(data) && !["state.json", "events.jsonl", join("bin", "chief")].some((f) => existsSync(join(data, f)))) {
    throw new Error(`${data} 不像 chief 的数据目录，不删`);
  }
  const remove: string[] = [];
  const keep: string[] = [];
  if (existsSync(data)) remove.push(data);
  if (isDefault && isDir(ws)) {
    for (const f of readdirSync(ws).sort()) {
      const p = join(ws, f);
      if (p === data) continue;
      if (f === "exports") keep.push(p);
      else remove.push(p);
    }
  }
  return { remove, keep, secrets: DESCRIPTORS.flatMap((d) => (d.secret ? [d.secret] : [])) };
}

// 照计划删：删之前每条再对一遍在不在该在的地方。返回删了的。
export async function runPurge(plan: PurgePlan, home: string, userHome: string, secrets: SecretStore): Promise<string[]> {
  const data = resolve(home);
  const ws = workspaceOf(resolve(userHome));
  // 先全对一遍，有一条不对就一个都不删。
  for (const p of plan.remove) {
    const bad = checkTarget(p, userHome);
    if (bad) throw new Error(bad);
    if (p !== data && dirname(p) !== ws) throw new Error(`${p} 不在 chief 的目录里，不删`);
  }
  const done: string[] = [];
  for (const p of plan.remove) {
    rmSync(p, { recursive: true, force: true });
    done.push(p);
  }
  if (plan.keep.length === 0 && isDir(ws) && data === join(ws, "data") && readdirSync(ws).length === 0) {
    rmSync(ws, { recursive: true });
    done.push(ws);
  }
  for (const name of plan.secrets) {
    if (await secrets.has(name)) {
      await secrets.delete(name);
      done.push(`钥匙串 chief:${name}`);
    }
  }
  return done;
}

export function describePlan(plan: PurgePlan): string {
  return [
    "要删的：",
    "  - 后台引擎（launchd 里的 chief）和 chief 命令",
    ...plan.remove.map((p) => `  - ${p}`),
    ...plan.secrets.map((n) => `  - 钥匙串里的 chief:${n}（有的话）`),
    ...(plan.keep.length > 0 ? ["留着的（你导出的备份，要删自己删）：", ...plan.keep.map((p) => `  - ${p}`)] : []),
  ].join("\n");
}

export const PURGE_LEFT = "还剩 chief 插件本身和它在 Claude 里的存储（面板的钥匙在那）：在 Claude 里打 /plugin，找到 chief 卸载。";
