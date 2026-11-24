// engine.log：launchd 把引擎的输出接到这个文件上（一直开着，追加写），所以换文件用「复制再清空」：
// engine.log → engine.log.1 → engine.log.2，原文件截成 0，引擎接着往里写，不用重开。最多留两份旧的。
import { closeSync, copyFileSync, existsSync, fstatSync, openSync, readSync, renameSync, statSync, truncateSync } from "node:fs";

export const KEEP_LOGS = 2;

// 换一次：返回换了没有。maxBytes 给了的话，没超过就不换；空文件不换。
export function rotateLog(file: string, maxBytes = 0): boolean {
  if (!existsSync(file)) return false;
  const size = statSync(file).size;
  if (size === 0 || size <= maxBytes) return false;
  for (let i = KEEP_LOGS - 1; i >= 1; i--) if (existsSync(`${file}.${i}`)) renameSync(`${file}.${i}`, `${file}.${i + 1}`);
  copyFileSync(file, `${file}.1`);
  truncateSync(file, 0);
  return true;
}

// 文件最后 n 行：只读结尾一段（最多 maxBytes），日志再大也不整个读进来。
export function tailLines(file: string, n: number, maxBytes = 256 * 1024): string[] {
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    const len = Math.min(size, maxBytes);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString("utf8").split("\n");
    // 从中间开始读的：第一行多半是半截，扔掉。
    if (len < size) lines.shift();
    if (lines.at(-1) === "") lines.pop();
    return lines.slice(-n);
  } finally {
    closeSync(fd);
  }
}
