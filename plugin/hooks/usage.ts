// 主会话用掉了多少订阅额度（5 小时窗口、每周窗口）。
// Claude Code 只给整个账号的百分比（/usage 看到的那两个数），而且只在调完模型时更新，不按会话拆。这里主会话每调完一次模型读一次，
// 比上一次涨了多少就记在主会话头上，按天累计，写进 chief 数据目录的 hub-usage.json，面板「测评」页显示。
//   - 上一次读数在 READING_MS 内（同一轮里接连的几次调用）才算量到的；隔得久（主会话闲了一阵、别的会话在用），
//     涨的不全是主会话的，这次就按「量到的那些调用平均每份 token 涨多少」估。
//   - 百分比只精确到 0.1，你同时开着别的会话时也会混进一点，所以面板上写「约」。
import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, ModelUsage } from 'claude-code'

import type { HubUsage, UsageDay } from '../types'
import { chiefFiles } from './data'

// 本会话是不是主会话：挂上 chief events --follow 的 Monitor 时记下（只记本会话的，不跨会话）。
const hub = atom({ plugin: 'chief', key: 'hub' } as const, false)
// 本会话上一次读到的额度百分比。
const lastReading = atom({ plugin: 'chief', key: 'reading' } as const, null as Reading | null)

type Reading = { at: number; five: number | null; week: number | null }

const READING_MS = 90_000
const KEEP_DAYS = 14

// 各类 token 大致按价钱折成同一种份量（额度也大致这么扣）：缓存读最便宜，输出最贵。
export function weightOf(u: ModelUsage): number {
  return u.input_tokens + u.output_tokens * 5 + u.cache_creation_input_tokens * 2 + u.cache_read_input_tokens * 0.05
}

export function isHubMonitor(command: string | undefined): boolean {
  return command !== undefined && /chief events\b/.test(command) && command.includes('--follow')
}

export async function markHub($: Engine) {
  await update($, hub, () => true)
}

export async function isHub($: Engine): Promise<boolean> {
  return read($, hub)
}

export async function readingNow($: Engine): Promise<Reading & { context: number | null; window: number; fiveReset?: string; weekReset?: string }> {
  const u = await $.session.usage()
  const five = u.rateLimits.find(r => r.kind === 'five_hour')
  const week = u.rateLimits.find(r => r.kind === 'seven_day')
  return {
    at: Date.now(), five: five?.percentUsed ?? null, week: week?.percentUsed ?? null,
    context: u.context.tokens ?? null, window: u.context.window,
    ...(five?.resetsAt ? { fiveReset: five.resetsAt } : {}), ...(week?.resetsAt ? { weekReset: week.resetsAt } : {}),
  }
}

export function dayOf(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const emptyDay = (): UsageDay => ({ calls: 0, weight: 0, five: 0, week: 0, measured: { weight: 0, five: 0, week: 0 } })

// 记一次调模型：before 是调之前本会话上一次的读数，after 是调完的。纯函数，测得到。
export function addCall(file: HubUsage, before: Reading | null, after: Awaited<ReturnType<typeof readingNow>>, usage: ModelUsage): HubUsage {
  const w = weightOf(usage)
  const day = dayOf(after.at)
  const d = { ...emptyDay(), ...file.days[day] }
  d.measured = { ...d.measured }
  const fresh = before !== null && after.at - before.at <= READING_MS
  const delta = (k: 'five' | 'week') => {
    const a = after[k]
    const b = before?.[k]
    if (a === null) return 0
    // 刚量的这次挨得近：涨多少记多少（窗口重置了会变小，那就只算重置后的这点）。
    if (fresh && b !== null && b !== undefined) return a >= b ? a - b : a
    // 隔得久：按量到的平均速度估。
    const rate = d.measured.weight > 0 ? d.measured[k] / d.measured.weight : (file.rate?.[k] ?? 0)
    return w * rate
  }
  const five = delta('five')
  const week = delta('week')
  if (fresh) d.measured = { weight: d.measured.weight + w, five: d.measured.five + five, week: d.measured.week + week }
  d.calls += 1
  d.weight += w
  d.five += five
  d.week += week
  const days = Object.fromEntries(Object.entries({ ...file.days, [day]: d }).sort(([a], [b]) => a.localeCompare(b)).slice(-KEEP_DAYS))
  // 跨天也能用的平均速度：最近几天量到的合起来。
  const m = Object.values(days).reduce((s, x) => ({ weight: s.weight + x.measured.weight, five: s.five + x.measured.five, week: s.week + x.measured.week }), { weight: 0, five: 0, week: 0 })
  return {
    days,
    rate: m.weight > 0 ? { five: m.five / m.weight, week: m.week / m.weight } : file.rate,
    now: {
      at: new Date(after.at).toISOString(), context: after.context, window: after.window, five: after.five, week: after.week,
      ...(after.fiveReset ? { fiveReset: after.fiveReset } : {}), ...(after.weekReset ? { weekReset: after.weekReset } : {}),
    },
  }
}

// 主会话调了一次模型：读额度、记一笔。出错不影响主会话。
export async function recordCall($: Engine, usage: ModelUsage) {
  const before = await read($, lastReading)
  const after = await readingNow($)
  await update($, lastReading, () => ({ at: after.at, five: after.five, week: after.week }))
  const path = (await chiefFiles($)).hubUsage
  let file: HubUsage = { days: {} }
  try {
    file = JSON.parse(await $.fs.read(path)) as HubUsage
  } catch {
    // 第一次记
  }
  await $.fs.write(path, JSON.stringify(addCall(file, before, after, usage)))
}

