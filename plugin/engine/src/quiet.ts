// 免打扰：config.json 的 quietHours 时段里，引擎的系统通知先不弹，记进 held.json；时段一过合成一条弹出来，也进下一份汇总（chief digest）。
// 要紧的（数据文件坏了、「以你的名义发」的钥匙被换了）不管免打扰照样弹。主会话的推送由它自己看 chief quiet 决定（见 hub skill）。
// 自动发出的回复不受免打扰影响：免打扰是不打扰你，不是不回别人。
import { liveConfig } from "./config";
import { quietState } from "./shared/schedule";
import { paths, readJson, updateJson } from "./store";

export interface HeldNotice {
  at: string;
  title: string;
  body: string;
  // 免打扰结束时合成的那条已经弹过了。
  shown?: boolean;
}

interface HeldFile {
  items: HeldNotice[];
}

const MAX_HELD = 50;

export function quietNow(now = new Date()): { quiet: boolean; until: string | null; hours: { start: string; end: string } | null } {
  const hours = liveConfig().quietHours;
  return { ...quietState(hours, now), hours };
}

// 现在免打扰的话，把这条通知记下、返回 true（不弹）；不是免打扰返回 false。读不了设置就当不是（宁可打扰也别丢）。
export function holdIfQuiet(title: string, body: string, now = new Date()): boolean {
  try {
    if (!quietNow(now).quiet) return false;
    updateJson<HeldFile, void>(paths().held, { items: [] }, (f) => {
      f.items = [...(f.items ?? []), { at: now.toISOString(), title, body }].slice(-MAX_HELD);
    });
    return true;
  } catch {
    return false;
  }
}

// 免打扰过了、还有没弹的：拿出来（标成弹过了），由引擎合成一条弹出。还在免打扰时返回空的。
export function takeHeld(now = new Date()): HeldNotice[] {
  if (quietNow(now).quiet) return [];
  if (readJson<HeldFile>(paths().held, { items: [] }).items?.every((x) => x.shown) !== false) return [];
  return updateJson<HeldFile, HeldNotice[]>(paths().held, { items: [] }, (f) => {
    const out = (f.items ?? []).filter((x) => !x.shown);
    for (const x of out) x.shown = true;
    return out.map((x) => ({ ...x }));
  });
}

// since 以后攒下的（给汇总用）。
export function heldSince(since: string): HeldNotice[] {
  return (readJson<HeldFile>(paths().held, { items: [] }).items ?? []).filter((x) => x.at > since);
}
