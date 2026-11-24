// 稍后再说：事情先收起来，到点再拿出来。chief thing snooze / wake 改 things.json 的 snooze，引擎每分钟看一眼到点的（wakeDue），
// 叫醒（去掉 snooze）、弹个通知，再交给主会话一条 thing.woke，让它重新跟进。
// 时间按这台电脑的时区算。
import { loadThings, paths, updateJson, type Thing, type ThingsFile } from "./store";

const WEEKDAYS: Record<string, number> = {
  日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6,
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};

// 「9点」「9点半」「上午9点」「下午3点」「15:30」「09:00」「9am」「3pm」→ [时, 分]；没写时间是 null，写得不对是 undefined。
function timeOf(text: string): [number, number] | null | undefined {
  const t = text.trim().toLowerCase();
  if (t === "") return null;
  let m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (m) return clock(Number(m[1]), Number(m[2]));
  m = /^(早上|上午|中午|下午|晚上)?\s*(\d{1,2})\s*点\s*(半|(\d{1,2})\s*分?)?$/.exec(t);
  if (m) {
    let h = Number(m[2]);
    if ((m[1] === "下午" || m[1] === "晚上") && h < 12) h += 12;
    if (m[1] === "中午" && h < 6) h += 12;
    return clock(h, m[3] === "半" ? 30 : m[4] ? Number(m[4]) : 0);
  }
  m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/.exec(t);
  if (m) {
    const h = Number(m[1]) % 12 + (m[3] === "pm" ? 12 : 0);
    return clock(h, Number(m[2] ?? 0));
  }
  return undefined;
}

function clock(h: number, min: number): [number, number] | undefined {
  return h <= 23 && min <= 59 ? [h, min] : undefined;
}

// 某天的几点（没写时间按早上 9 点）。
function at(day: Date, time: [number, number] | null): Date {
  const d = new Date(day);
  const [h, min] = time ?? [9, 0];
  d.setHours(h, min, 0, 0);
  return d;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

// --until 的写法：
//   2026-11-30T09:00:00Z、2026-11-30 15:00、2026-11-30（早上 9 点）
//   30m、2h、1d、1w（也认 30分钟、2小时、1天、1周）
//   tomorrow 09:00、明天9点、明天下午3点、今天 18:00、后天
//   monday、next monday 09:00、周五、下周一、星期三下午2点
// 算出来不在以后的（今天 9 点已经过了）返回 null。看不懂也返回 null。
export function parseUntil(raw: string, now: Date = new Date()): Date | null {
  const text = raw.trim().replace(/\s+/g, " ");
  const lower = text.toLowerCase();
  const future = (d: Date | null) => (d && !Number.isNaN(d.getTime()) && d.getTime() > now.getTime() ? d : null);

  let m = /^(\d+)\s*(m|min|mins|分钟|h|hr|hrs|小时|个小时|d|day|days|天|w|week|weeks|周|星期)$/.exec(lower);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2]!;
    const ms = /^(m|min|mins|分钟)$/.test(unit) ? 60_000 : /^(h|hr|hrs|小时|个小时)$/.test(unit) ? 3_600_000 : /^(d|day|days|天)$/.test(unit) ? 86_400_000 : 7 * 86_400_000;
    if (n <= 0 || n * ms > 366 * 86_400_000) return null;
    return new Date(now.getTime() + n * ms);
  }

  m = /^(\d{4}-\d{2}-\d{2})(?:[ t](.*))?$/i.exec(text);
  if (m) {
    const rest = m[2]?.trim() ?? "";
    // 带时区的完整 ISO 时间交给 Date 自己算。
    if (/(z|[+-]\d{2}:?\d{2})$/i.test(rest)) return future(new Date(text));
    const time = timeOf(rest.replace(/^(\d{1,2}:\d{2}):\d{2}(\.\d+)?$/, "$1"));
    if (time === undefined) return null;
    const [y, mo, d] = m[1]!.split("-").map(Number);
    return future(at(new Date(y!, mo! - 1, d!), time));
  }

  m = /^(今天|今晚|明天|明早|后天|today|tonight|tomorrow)\s*(.*)$/.exec(lower);
  if (m) {
    const word = m[1]!;
    const n = word === "明天" || word === "明早" || word === "tomorrow" ? 1 : word === "后天" ? 2 : 0;
    let time = timeOf(m[2]!);
    if (time === undefined) return null;
    if (time === null && (word === "今晚" || word === "tonight")) time = [20, 0];
    if (time && (word === "今晚" || word === "tonight") && time[0] < 12) time = [time[0] + 12, time[1]];
    return future(at(addDays(now, n), time));
  }

  m = /^(下周|下星期|下礼拜|next\s+|this\s+)?(?:周|星期|礼拜)?(日|天|一|二|三|四|五|六|sunday|sun|monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat)\s*(.*)$/.exec(lower);
  if (m && (m[1] || /^(周|星期|礼拜)/.test(lower) || /^[a-z]/.test(m[2]!))) {
    const want = WEEKDAYS[m[2]!]!;
    const time = timeOf(m[3]!);
    if (time === undefined) return null;
    const prefix = (m[1] ?? "").trim();
    let n = (want - now.getDay() + 7) % 7;
    if (prefix === "下周" || prefix === "下星期" || prefix === "下礼拜") {
      // 下周 X：下一个周一开始的那一周里的 X（周日算一周的最后一天）。
      const toMonday = ((1 - now.getDay() + 7) % 7) || 7;
      n = toMonday + ((want + 6) % 7);
    } else if (prefix === "next") {
      if (n === 0) n = 7;
    } else if (n === 0 && at(now, time).getTime() <= now.getTime()) n = 7;
    return future(at(addDays(now, n), time));
  }

  // 别的写法交给 Date（比如 2026/11/30 09:00）。
  if (/^\d{4}[/.]\d{1,2}[/.]\d{1,2}/.test(text)) return future(new Date(text));
  return null;
}

// 稍后再说的事情到点了没有：到点（或时间写坏了）的算该叫醒。
export function snoozeDue(t: Pick<Thing, "snooze">, now: number): boolean {
  if (!t.snooze) return false;
  const until = Date.parse(t.snooze.until);
  return Number.isNaN(until) || until <= now;
}

// 叫醒到点的事情：去掉 snooze，进展里记一笔。返回叫醒了哪些（叫醒以后的样子）。办完 / 不做了的顺手清掉，不算。
export function wakeDue(now = Date.now()): Thing[] {
  // 先不拿锁看一眼：每分钟都跑，没到点的就别去写文件（写了面板会跟着刷新）。
  if (!loadThings().things.some((x) => snoozeDue(x, now))) return [];
  return updateJson<ThingsFile, Thing[]>(paths().things, { nextThing: 1, nextAsk: 1, things: [], asks: [] }, (t) => {
    const out: Thing[] = [];
    const at = new Date(now).toISOString();
    for (const x of t.things) {
      if (!snoozeDue(x, now)) continue;
      delete x.snooze;
      if (x.status === "done" || x.status === "dropped") continue;
      x.log = [...x.log, { at, text: "稍后再说的时间到了，拿出来接着跟" }].slice(-30);
      out.push({ ...x });
    }
    return out;
  });
}
