// 跟着一个只追加的文件读新的行（chief events --follow 用）：记住读到第几个字节，每次只读后来追加的那段。
// 归档会把 events.jsonl 重写成一个新文件（改名换上去）：换了文件（inode 变了）或者变短了，就从头再读一遍，
// 已经交过的由调用的一方按编号跳过。没写完的半行留到下次。
import { closeSync, fstatSync, openSync, readSync } from "node:fs";

export class LineTail {
  private offset = 0;
  private ino = -1;
  private rest = Buffer.alloc(0);

  constructor(private readonly file: string) {}

  // 新的整行（不含换行）。文件还没有就是空的。
  read(): string[] {
    let fd: number;
    try {
      fd = openSync(this.file, "r");
    } catch {
      return [];
    }
    try {
      const st = fstatSync(fd);
      if (st.ino !== this.ino || st.size < this.offset) {
        this.ino = st.ino;
        this.offset = 0;
        this.rest = Buffer.alloc(0);
      }
      if (st.size === this.offset) return [];
      const buf = Buffer.alloc(st.size - this.offset);
      const got = readSync(fd, buf, 0, buf.length, this.offset);
      this.offset += got;
      // 按字节找换行：半个汉字不会被拆坏。
      const data = Buffer.concat([this.rest, buf.subarray(0, got)]);
      const end = data.lastIndexOf(0x0a);
      this.rest = Buffer.from(data.subarray(end + 1));
      if (end < 0) return [];
      return data.subarray(0, end).toString("utf8").split("\n").filter((l) => l.trim() !== "");
    } finally {
      closeSync(fd);
    }
  }
}
