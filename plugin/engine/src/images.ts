// 回复里附的图（只有 Slack）：只认真的图片，看文件开头几个字节，不看扩展名；不认软链接，单张不超过 10MB，一条最多 4 张。
// 收下时复制一份进 drafts/images，之后发出去的就是你在待发出里确认过的那份：原文件后来被改、被换成别的，都不影响。
// 这样也没法借「附图」把密钥之类的文件发出去：不是图片的一律拒收。
import { closeSync, copyFileSync, lstatSync, mkdirSync, openSync, readSync } from "node:fs";
import { basename, join } from "node:path";
import type { ReplyImage } from "./shared/types";

export type { ReplyImage };

export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// 文件开头的字节 → 是哪种图片。
export function sniffImage(head: Uint8Array): { ext: string; mime: string } | null {
  const b = Buffer.from(head);
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: "png", mime: "image/png" };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (b.length >= 6 && (b.subarray(0, 6).toString("latin1") === "GIF87a" || b.subarray(0, 6).toString("latin1") === "GIF89a")) return { ext: "gif", mime: "image/gif" };
  if (b.length >= 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return { ext: "webp", mime: "image/webp" };
  return null;
}

// 检查一张图能不能附，能的话复制进 dir，返回记录；不能就抛错（给人看的原因）。
export function takeImage(path: string, dir: string, prefix: string): ReplyImage {
  let st;
  try {
    st = lstatSync(path);
  } catch {
    throw new Error(`找不到图片：${basename(path)}`);
  }
  if (st.isSymbolicLink()) throw new Error(`${basename(path)} 是个链接，给图片文件本身`);
  if (!st.isFile()) throw new Error(`${basename(path)} 不是文件`);
  if (st.size > MAX_IMAGE_BYTES) throw new Error(`${basename(path)} 超过 10MB`);
  const head = Buffer.alloc(16);
  const fd = openSync(path, "r");
  let n: number;
  try {
    n = readSync(fd, head, 0, head.length, 0);
  } finally {
    closeSync(fd);
  }
  const kind = sniffImage(head.subarray(0, n));
  if (!kind) throw new Error(`${basename(path)} 不是图片（只收 PNG、JPEG、GIF、WebP）`);
  // 发到 Slack 上的文件名：去掉路径和控制字符，太长截断，扩展名按真实类型。
  const stem = basename(path).replace(/\.[^.]*$/, "").replace(/[\u0000-\u001f\\/]/g, "").slice(0, 80) || "image";
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `${prefix}.${kind.ext}`);
  copyFileSync(path, file);
  return { file, name: `${stem}.${kind.ext}`, bytes: st.size, mime: kind.mime };
}
