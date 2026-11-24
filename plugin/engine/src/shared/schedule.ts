// 免打扰时段和每天汇总的时间怎么算：引擎、命令行、面板共用。纯 TypeScript（见 sources.ts 开头）。
// 时间都是本机的当地时间 HH:MM；免打扰可以跨半夜（22:00–08:00）。

export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export type QuietHours = { start: string; end: string } | null;
export type DigestTimes = { morning: string | null; evening: string | null };
export type DigestSlot = keyof DigestTimes;
export const DIGEST_SLOTS: readonly DigestSlot[] = ["morning", "evening"];
export const DIGEST_LABELS: Readonly<Record<DigestSlot, string>> = { morning: "早上的汇总", evening: "晚上的汇总" };

// 引擎睡着（合盖）错过了汇总的点：醒来时离那个点不超过这么久就补一次，再久就不补了（下一个点照常）。
export const DIGEST_GRACE_MS = 3 * 3600_000;

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

// 某天（now 那天往后挪 days 天）的 HH:MM，当地时间。
function at(now: Date, hhmm: string, days = 0): Date {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, h, m, 0, 0);
}

// 当地日期 YYYY-MM-DD。
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 现在是不是免打扰时段；是的话到几点结束。开始和结束一样算没设。
export function quietState(q: QuietHours, now: Date): { quiet: boolean; until: string | null } {
  if (!q || q.start === q.end) return { quiet: false, until: null };
  const s = minutes(q.start);
  const e = minutes(q.end);
  const m = now.getHours() * 60 + now.getMinutes();
  const quiet = s < e ? m >= s && m < e : m >= s || m < e;
  if (!quiet) return { quiet: false, until: null };
  const end = m < e ? at(now, q.end) : at(now, q.end, 1);
  return { quiet: true, until: end.toISOString() };
}

// 「22:00-08:00」「22:00–08:00」「22:00 08:00」→ {start, end}；认不出返回 null。
export function parseQuietRange(text: string): { start: string; end: string } | null {
  const m = /^\s*(\d{1,2}:\d{2})\s*(?:-|–|—|~|到|\s)\s*(\d{1,2}:\d{2})\s*$/.exec(text);
  if (!m) return null;
  const pad = (t: string) => t.padStart(5, "0");
  const [start, end] = [pad(m[1]!), pad(m[2]!)];
  return HHMM.test(start) && HHMM.test(end) && start !== end ? { start, end } : null;
}

// 到点该发的汇总：每个时段每天最多一次（fired 记着每个时段上次发的是哪天）。
// 今天的点过了、还没发（比记着的那天新）、离那个点不超过 grace 就发；昨天的点（比如 23:00，半夜才醒）同样算。
export function dueDigests(times: DigestTimes, fired: Partial<Record<DigestSlot, string>>, now: Date, grace = DIGEST_GRACE_MS): { slot: DigestSlot; date: string; at: Date }[] {
  const out: { slot: DigestSlot; date: string; at: Date }[] = [];
  for (const slot of DIGEST_SLOTS) {
    const t = times[slot];
    if (!t) continue;
    for (const days of [0, -1]) {
      const when = at(now, t, days);
      if (when.getTime() > now.getTime()) continue;
      if (now.getTime() - when.getTime() <= grace && (fired[slot] ?? "") < dateKey(when)) out.push({ slot, date: dateKey(when), at: when });
      break;
    }
  }
  return out;
}
