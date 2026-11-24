// 「要你」：所有要你动手的事，算成一份。页签上的数字、「要你」页画什么，都按这一份。
//   - 系统的事：钥匙被动过、数据文件坏了、引擎没在跑、主会话没在听、来源连不上、插件更新了要重读规则、它提议的规矩。
//   - 事情的卡：一件事一张，里面是这件事所有等你的——会话停在对话框上等你点、要你定的问题、等你确认的回复。
//     不挂在事情上的回复各自一张。
// 纯函数：只看 Snapshot 和现在几点，测得到。
import { DATA_HEALTH } from '../engine/src/shared/rules'
import type { AskRow, ReplyRow, Snapshot, ThingRow } from '../types'
import { daysLeft, live, snoozed, startOfToday } from './ui'

export type SysItem =
  | { kind: 'key'; at: string; what: 'reset' | 'set' }
  | { kind: 'corrupt'; why: string }
  | { kind: 'engine' }
  | { kind: 'hub'; unhandled: number; lastAt: string | null }
  | { kind: 'source'; id: string; why: string; at: string }
  | { kind: 'reread' }
  | { kind: 'proposal'; id: number; text: string; basis: string }

export type Card = {
  key: string
  thing: ThingRow | null
  // 会话停在对话框上等你点（Allow、选项）：它什么都做不了，就等你。
  waiting: string | null
  session: string | null
  asks: AskRow[]
  // 你刚定的（两分钟内能撤回）、今天撤掉的：缩成一行。
  closed: AskRow[]
  // 等你确认的、没发出去的。
  replies: ReplyRow[]
  // 正在发的（5 秒内能撤回）。
  sending: ReplyRow[]
  // 越小越急：0 会话等你点、1 过期或今天截止、2 有回复没发出去、3 两天内截止、4 其余。
  rank: number
  // 最近一条等你的什么时候来的（同样急的，新的在前）。
  since: string
}

export type Inbox = { system: SysItem[]; cards: Card[]; count: number; withdrawn: AskRow[] }

export const REOPEN_MS = 120_000

const SOURCE_FAILS = 2

export function inboxOf(s: Snapshot, now = Date.now()): Inbox {
  const system: SysItem[] = []
  const lastKey = s.keyAlerts.at(-1)
  if (lastKey) system.push({ kind: 'key', at: lastKey.at, what: lastKey.what })
  const corrupt = s.health[DATA_HEALTH]
  if (corrupt && !corrupt.ok) system.push({ kind: 'corrupt', why: corrupt.error ?? '' })
  if (s.engineAt === null) system.push({ kind: 'engine' })
  if (!s.hub.listening) system.push({ kind: 'hub', unhandled: s.unhandled, lastAt: s.hub.lastAt })
  for (const [id, h] of Object.entries(s.health)) {
    if (id !== DATA_HEALTH && s.sources[id] === true && h.fails >= SOURCE_FAILS) system.push({ kind: 'source', id, why: h.error ?? '', at: h.at })
  }
  // 主会话没在听时不提重读：开张时会读到最新的。
  if (s.reread && s.hub.listening) system.push({ kind: 'reread' })
  for (const p of s.policy?.proposals ?? []) system.push({ kind: 'proposal', id: p.id, text: p.text, basis: p.basis })

  const dayStart = startOfToday()
  const byKey = new Map<string, Card>()
  const thingOf = (id: number | undefined) => (id === undefined ? undefined : s.things.find(t => t.id === id))
  const card = (key: string, thing: ThingRow | null): Card => {
    let c = byKey.get(key)
    if (!c) {
      c = { key, thing, waiting: null, session: thing?.session ?? null, asks: [], closed: [], replies: [], sending: [], rank: 4, since: '' }
      byKey.set(key, c)
    }
    return c
  }
  const ofThing = (t: ThingRow) => card(`t${t.id}`, t)

  for (const t of s.things) {
    const waiting = t.session ? s.activity[t.session]?.waiting : null
    if (live(t) && waiting) {
      const c = ofThing(t)
      c.waiting = waiting
      c.since = s.activity[t.session!]?.at ?? ''
    }
  }
  // 问题挂着的回复已经发了 / 不发了 / 在重写：问题不用再答（引擎现在会跟着关掉，这里兜住以前留下的）。
  const replyGone = (a: AskRow) => {
    if (a.reply === undefined) return false
    const r = s.replies.find(x => x.id === a.reply)
    return r !== undefined && r.status !== 'pending' && r.status !== 'failed'
  }
  for (const a of s.asks) {
    const t = thingOf(a.thing)
    // 稍后再说的事情：它的问题也先收起。
    if (t && snoozed(t)) continue
    if (a.status === 'open' && replyGone(a)) continue
    const key = t ? `t${t.id}` : `a${a.id}`
    const closedAt = a.closedAt === undefined ? NaN : Date.parse(a.closedAt)
    if (a.status === 'open') card(key, t ?? null).asks.push(a)
    else if ((a.status === 'answered' || a.status === 'dismissed') && now - closedAt < REOPEN_MS) card(key, t ?? null).closed.push(a)
  }
  for (const r of s.replies) {
    const t = thingOf(r.thing)
    const c = t ? ofThing(t) : null
    if (r.status === 'pending' || r.status === 'failed') (c ?? card(`r${r.id}`, null)).replies.push(r)
    else if (r.status === 'queued' || r.status === 'sending') (c ?? card(`r${r.id}`, null)).sending.push(r)
  }

  const cards = [...byKey.values()].filter(c => c.waiting || c.asks.length > 0 || c.closed.length > 0 || c.replies.length > 0 || c.sending.length > 0)
  const shown = new Set(cards.map(c => c.thing?.id))
  for (const c of cards) {
    // 新问的在前。
    c.asks.sort((a, b) => b.at.localeCompare(a.at))
    // 今天撤掉的问题：卡还在的就跟在卡上（灰字说为什么）。
    if (c.thing) c.closed.push(...s.asks.filter(a => a.thing === c.thing!.id && a.status === 'withdrawn' && a.closedAt !== undefined && Date.parse(a.closedAt) >= dayStart))
    // 还在等你的里面最新的一条；只剩刚定的、撤掉的，就看那些。
    const waitingOn = [c.waiting ? c.since : '', ...c.asks.map(a => a.at), ...c.replies.map(r => r.at), ...c.sending.map(r => r.at)].filter(Boolean).sort()
    const done = c.closed.map(a => a.closedAt ?? a.at).sort()
    c.since = waitingOn.at(-1) ?? done.at(-1) ?? ''
    const left = c.thing?.due === undefined ? null : daysLeft(c.thing.due)
    c.rank = c.waiting ? 0 : left !== null && left <= 0 ? 1 : c.replies.some(r => r.status === 'failed') ? 2 : left !== null && left <= 2 ? 3 : 4
  }
  cards.sort((a, b) => a.rank - b.rank || b.since.localeCompare(a.since))
  // 整件事没有别的等你的、只剩今天撤掉的问题：放在最底下一行行列出来，让你知道它为什么没了。
  const withdrawn = s.asks.filter(a => a.status === 'withdrawn' && a.closedAt !== undefined && Date.parse(a.closedAt) >= dayStart && !shown.has(a.thing))

  const count = system.length + cards.reduce((n, c) => n + (c.waiting ? 1 : 0) + c.asks.length + c.replies.length, 0)
  return { system, cards, count, withdrawn }
}
