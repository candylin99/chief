// 「以你的名义发」（署名 confirmed by 你）只有两条路，都由插件带钥匙走 chief reply confirm，主会话自己发不了：
//   1. 你在面板上点发送。
//   2. 你在主会话里说了「发」：主会话只能 chief reply ask-confirm R 提请求。插件核对这个请求是在你亲口说过话之后、15 分钟内提的
//      （你说的话由 Claude Code 标来源：你在输入框里敲的，或者从手机 / 网页端发的；Slack 通知、插件、别的会话塞进来的都不算），
//      才带着你的原话发；核对不上就留在待发出，面板上请你点。
// 钥匙第一次加载时生成，原文只在插件自己的存储（$.store）里，chief 数据目录只有它的指纹（chief key set）。
import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine } from 'claude-code'

import type { ReplyRow } from '../types'
import { chiefDir, chiefFiles } from './data'

// 你在这个会话里最近亲口说的一句话（本会话的，不跨会话）。
const said = atom({ plugin: 'chief', key: 'said' } as const, null as { text: string; at: number } | null)
const SAID_MS = 15 * 60_000

export async function confirmKey($: Engine): Promise<string> {
  const have = await $.store.get('confirmKey')
  if (typeof have === 'string' && /^[0-9a-f]{64}$/.test(have)) return have
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const key = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  await $.store.set('confirmKey', key)
  return key
}

// 引擎装好了就把钥匙交给它记指纹（已经是这把就什么都不变）。对不上：你重装过插件、钥匙丢了，设置页请你在终端 chief key reset。
export async function ensureKey($: Engine): Promise<'ok' | 'mismatch' | 'none'> {
  const bin = `${await chiefDir($)}/bin/chief`
  try {
    await $.fs.read(bin)
  } catch {
    return 'none'
  }
  const out = await $.process.run([bin, 'key', 'set'], { stdin: await confirmKey($) }).catch(() => null)
  return out?.exitCode === 0 ? 'ok' : 'mismatch'
}

// 记下你亲口说的话（调用方只在来源是你本人时调）。
export async function noteUserSaid($: Engine, text: string) {
  await update($, said, () => ({ text: text.trim().slice(0, 300), at: Date.now() }))
}

// 哪些回复能凭你这句话以你的名义发：还能发、主会话请求过、请求是在你说完以后提的；你这句话 15 分钟内有效。
export function askedAfter(items: readonly ReplyRow[], s: { at: number } | null, now: number): number[] {
  if (s === null || now - s.at > SAID_MS) return []
  return items.filter(r => (r.status === 'pending' || r.status === 'failed') && r.confirmAsk && Date.parse(r.confirmAsk.at) >= s.at).map(r => r.id)
}

// 主会话跑过 ask-confirm 之后：你说完话以后、15 分钟内请求的，带着你的原话以你的名义发。别的不动，留在待发出等你点。
export async function confirmAsked($: Engine) {
  const s = await read($, said)
  if (s === null) return
  let items: ReplyRow[]
  try {
    items = (JSON.parse(await $.fs.read((await chiefFiles($)).replies)) as { items?: ReplyRow[] }).items ?? []
  } catch {
    return
  }
  const asked = askedAfter(items, s, Date.now())
  if (asked.length === 0) return
  const key = await confirmKey($)
  for (const id of asked) {
    await $.process.run([`${await chiefDir($)}/bin/chief`, 'reply', 'confirm', String(id)], { stdin: JSON.stringify({ key, how: 'chat', said: s.text }) }).catch(() => null)
  }
}

// 面板上点发送：以你的名义发。
export async function confirmFromPanel($: Engine): Promise<string> {
  return JSON.stringify({ key: await confirmKey($), how: 'panel' })
}

// 面板上你自己改稿：新稿子连同钥匙一起交给 chief reply edit-yours。
export async function editFromPanel($: Engine, text: string): Promise<string> {
  return JSON.stringify({ key: await confirmKey($), text })
}

// 面板上改规矩：放宽发送的（直接发、直接 approve、白名单、固定回复、署名、采纳这类提议）要带钥匙才直接生效（chief rules --yours），
// 不带钥匙的（主会话改的）只会变成提议等你点。text 是这条命令本来从标准输入给的东西。
export async function rulesFromPanel($: Engine, text = ''): Promise<string> {
  return JSON.stringify({ key: await confirmKey($), text })
}
