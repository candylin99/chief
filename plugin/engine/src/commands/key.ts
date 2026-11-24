// chief key：「以你的名义发」的钥匙。钥匙原文只在 chief 插件自己的存储里，这里只存它的指纹（规矩怎么算见 gate.ts）。
import { createHash, timingSafeEqual } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { fail, stdinText } from "../args";
import { say } from "../engine";
import { msg } from "../messages";
import { ensureHome, paths } from "../store";

// 以你的名义发（confirmed by 你）要带钥匙：钥匙原文只在 chief 插件自己的存储里，这里只存它的指纹。
export function keyHash(key: string): Buffer {
  return createHash("sha256").update(key, "utf8").digest();
}

export function keyMatches(key: string): boolean {
  const file = paths().confirmKey;
  if (!existsSync(file) || !key) return false;
  const want = Buffer.from(readFileSync(file, "utf8").trim(), "hex");
  const got = keyHash(key);
  return want.length === got.length && timingSafeEqual(want, got);
}

// 钥匙的记录：first 第一次配（不用提醒）；reset 清掉了；set 清掉以后又配了一把（换了钥匙）。
export type KeyLogEntry = { at: string; what: "first" | "reset" | "set"; tty?: boolean };

export function keyLog(): KeyLogEntry[] {
  if (!existsSync(paths().keyLog)) return [];
  return readFileSync(paths().keyLog, "utf8").split("\n").flatMap((l) => {
    try {
      return l.trim() ? [JSON.parse(l) as KeyLogEntry] : [];
    } catch {
      return [];
    }
  });
}

// 钥匙换了：记一行（面板一直挂着提醒，直到你在面板上点知道了），再弹一条通知。
// 测试的数据目录在系统临时目录里：不弹（动的也不是你真的钥匙）。写死目录，不看 TMPDIR（那是谁都能设的）。
export const TEMP_DIRS = ["/tmp/", "/private/tmp/", "/var/folders/", "/private/var/folders/"];

export function keyChanged(what: KeyLogEntry["what"], tty: boolean): void {
  appendFileSync(paths().keyLog, `${JSON.stringify({ at: new Date().toISOString(), what, tty })}\n`, { mode: 0o600 });
  if (what === "first" || TEMP_DIRS.some((d) => paths().home.startsWith(d))) return;
  // 要紧的：免打扰也弹。
  say(msg().keyTitle, what === "reset" ? msg().keyReset : msg().keySet, true);
}

// 在终端里问一句，要你亲手敲 reset。
export async function askInTerminal(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return (await rl.question(prompt)).trim();
  } finally {
    rl.close();
  }
}

// chief key set|check（标准输入给钥匙）| reset：插件第一次加载时 set；已经有一把就不让换，要换你在终端先 reset。
// reset 要在终端里亲手敲 reset 确认，不给主会话悄悄清掉。主会话和你是同一个系统用户：它能造一个假终端、也能直接删钥匙文件，
// 拦不死；所以每次清、换都记进 key-log.jsonl 并弹通知，面板一直挂着提醒，直到你在面板上点知道了（这一步记在插件自己的存储里）。
export async function keyCmd(args: string[]): Promise<void> {
  const sub = args.shift();
  if (sub === "reset") {
    if (!process.stdin.isTTY) fail("chief key reset 要你在终端里亲手跑（会让你敲 reset 确认）；主会话不能替你清钥匙");
    const typed = await askInTerminal("清掉「以你的名义发」的钥匙：插件重新加载前，面板上的发送都用不了。确认就敲 reset：");
    if (typed !== "reset") fail("没清");
    if (existsSync(paths().confirmKey)) unlinkSync(paths().confirmKey);
    keyChanged("reset", true);
    process.stdout.write("钥匙清掉了：chief 插件下次加载会配一把新的（在那之前面板上的发送用不了）\n");
    return;
  }
  const key = (await stdinText()).trim();
  if (!/^[0-9a-f]{64}$/.test(key)) fail("钥匙从标准输入给：64 位十六进制");
  if (sub === "check") {
    if (!keyMatches(key)) fail("钥匙对不上");
    process.stdout.write("对上了\n");
    return;
  }
  if (sub === "set") {
    if (existsSync(paths().confirmKey)) {
      if (keyMatches(key)) {
        // 以前配的钥匙没有记录：补一行，之后被删了再配能认出是换了。
        if (keyLog().length === 0) keyChanged("first", false);
        return void process.stdout.write("已经是这把了\n");
      }
      fail("已经配过另一把钥匙：要换，你在终端跑 chief key reset，再重新加载插件");
    }
    ensureHome();
    writeFileSync(paths().confirmKey, `${keyHash(key).toString("hex")}\n`, { mode: 0o600 });
    keyChanged(keyLog().length === 0 ? "first" : "set", process.stdin.isTTY === true);
    process.stdout.write("钥匙配好了\n");
    return;
  }
  fail("chief key set|check|reset");
}
