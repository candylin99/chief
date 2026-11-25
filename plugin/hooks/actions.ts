// 面板上的动作。
// 不用动脑子的（发送、撤回、不发、改规矩、标对错、标办完）直接跑 chief 命令，文字从标准输入给；
// 要用到 App 会话工具或要动脑子的（转告工作会话、打开会话、让它重写、根据纠正提议规矩），交给主会话去做。
import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine } from 'claude-code'

import type { Locale } from '../engine/src/shared/i18n'
import type { Handle, ReplyMode, ReplyRow, SearchHit, Tab, ThingRow } from '../types'
import { confirmFromPanel, editFromPanel, noteUserSaid, rulesFromPanel } from './confirm'
import { refresh, chiefDir } from './data'
import { t } from './i18n'

const note = atom({ plugin: 'chief', key: 'note' } as const, '')
const tab = atom({ plugin: 'chief', key: 'tab' } as const, 'now')
const edits = atom({ plugin: 'chief', key: 'edits' } as const, {})
const open = atom({ plugin: 'chief', key: 'open' } as const, [])
const logs = atom({ plugin: 'chief', key: 'logs' } as const, '')
const basket = atom({ plugin: 'chief', key: 'basket' } as const, [])
const found = atom({ plugin: 'chief', key: 'found' } as const, null)
// 刚交给主会话的话 → 什么时候交的：那个按钮两分钟内画成灰字「已交给消息中心」，点不了。
const sent = atom({ plugin: 'chief', key: 'sent' } as const, {})

// 事情相关的函数里 t 是那件事情：字典用这个名字。
const t_ = t

// 面板顶上那句提示带着时间（「时间|文字」），过几秒就不再显示。
function stamp(text: string): string {
  return `${Date.now()}|${text}`
}

function short(text: string, max: number): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max)}…` : one
}

// 跑一个 chief 命令，把结果写在面板顶上，再刷新。
export async function act($: Engine, label: string, args: readonly string[], stdin?: string) {
  const bin = `${await chiefDir($)}/bin/chief`
  const out = await $.process.run([bin, ...args], stdin === undefined ? undefined : { stdin })
  const said = (out.exitCode === 0 ? out.stdout : out.stderr).trim()
  await update($, note, () => stamp((out.exitCode === 0 ? t().act.ok(label) : t().act.failed(label, short(said || t().noReason, 160)))))
  await refresh($)
  return out.exitCode === 0
}

// 直接跳到某个 Claude App 会话：App 认 claude://code/continue?session=local_<编号> 这个链接。
// 编号不像 App 的会话编号（比如别的地方来的），就退回让主会话给你一个能点的链接。
const APP_SESSION = /^local_[A-Za-z0-9-]{1,100}$/

export async function openSession($: Engine, session: string, title: string) {
  if (APP_SESSION.test(session)) {
    const out = await $.process.run(['/usr/bin/open', `claude://code/continue?session=${session}`])
    if (out.exitCode === 0) {
      await update($, note, () => stamp(t().act.jumped(short(title, 20))))
      return
    }
  }
  await tell($, `chief：打开会话 ${session}（${title}）`, t().act.toSession)
}

// ── 批注：在各处写几句，攒着一起发给主会话 ──

// 加一条批注（不发送）。同一处再批，就接在后面。
export async function annotate($: Engine, key: string, label: string, text: string) {
  await update($, basket, list => {
    const old = list.find(x => x.key === key && key !== 'note')
    return old ? list.map(x => (x === old ? { ...x, text: `${x.text}；${text}` } : x)) : [...list, { key, label, text }]
  })
  await update($, note, () => stamp(t().act.noted))
}

export async function unannotate($: Engine, index: number) {
  await update($, basket, list => list.filter((_, i) => i !== index))
}

export async function clearBasket($: Engine) {
  await update($, basket, () => [])
}

// 把攒的批注一次发给主会话：每条写明批在哪（带 chief 里的编号），主会话拆开分别去办、去转。
export async function sendBasket($: Engine) {
  const list = await read($, basket)
  if (list.length === 0) return
  // 先清空再交：清空之前又点一下，不会把同一批再交一遍。
  await update($, basket, () => [])
  const lines = list.map((x, i) => `${i + 1}. ${x.key === 'note' ? '' : `关于${x.label}：`}${x.text}`)
  if (!(await submitOnce($, `chief：批注（${list.length} 条）\n${lines.join('\n')}`))) return
  await update($, note, () => stamp(t().act.basketSent(list.length)))
}

// 交给主会话（hub skill 认这几句话）。
// 替你把一句话交给主会话。decision：这是你对「要你定」的拍板（照建议办、写了你的决定），算你亲口说的，
// 里面要替你发的回复插件凭它核对；导入、问进展、重读规则这类不算。
// 同一句话两分钟内只交给主会话一次：主会话在忙时点了没动静，人会再点一下，第二下不再交，只提示刚交过。
const DEDUPE_MS = 120_000
const recent = new Map<string, number>()

export function seenRecently(text: string, now = Date.now()): boolean {
  for (const [k, at] of recent) if (now - at >= DEDUPE_MS) recent.delete(k)
  if (recent.has(text)) return true
  recent.set(text, now)
  return false
}

// 面板往主会话交话都走这里：两分钟内交过同一句的不再交（返回 false，顶上提示刚交过）；交了就记下，那个按钮画成灰字。
export async function submitOnce($: Engine, text: string, label = ''): Promise<boolean> {
  if (seenRecently(text)) {
    await update($, note, () => stamp(t().act.already(label || short(text.replace(/^chief：/, ''), 16))))
    return false
  }
  const now = Date.now()
  await update($, sent, m => ({ ...Object.fromEntries(Object.entries(m).filter(([, at]) => now - at < DEDUPE_MS)), [text]: now }))
  void $.prompt.submit({ text })
  return true
}

// 画按钮时用：这句话是不是两分钟内刚交过（是就画成灰字，不给点）。
// 状态是异步读的：每次画面板前 register.tsx 读一次 sent 交给 setSentNow，画按钮时同步查这一份。
let sentNow: Record<string, number> = {}

export function setSentNow(m: Record<string, number>) {
  sentNow = m
}

export function justSent(_$: Engine, text: string): boolean {
  const at = sentNow[text]
  return at !== undefined && Date.now() - at < DEDUPE_MS
}

export async function tell($: Engine, text: string, label: string, decision = false) {
  if (decision) await noteUserSaid($, `${label}（面板上点的）：${text}`)
  if (!(await submitOnce($, text, label))) return
  await update($, note, () => stamp(t().act.handed(label)))
}

// 你在「要你定」上拍板：先在 chief 里记下回答（卡片马上收起，不用等主会话），再交给主会话转告那件事的会话。
export async function answerAsk($: Engine, id: number, answer: string, label: string, text: string) {
  if (!(await act($, label, ['ask', 'answer', String(id)], answer))) return
  await tell($, text, label, true)
}

// 「先问清楚」：先记下你想知道什么（卡片上马上显示在问），再交给主会话去问提出这个问题的会话；问题照旧等你定，不当成你的决定。
export async function explainAsk($: Engine, id: number, asked: string, label: string) {
  if (!(await act($, label, ['ask', 'explain', String(id), '--ask'], asked))) return
  await tell($, `chief：问题 #${id} 先问清楚：${asked}`, label)
}

// 通知卡上的两个按钮（直接跑 chief，不经过主会话；重复点什么都不做）：
// react 为 true 是「已读并回 👀」，排上让引擎在那条 Slack 消息上加 :eyes:；false 是「已读」，只标已读，不碰 Slack。
export async function readNotice($: Engine, event: number, label: string, react = true) {
  await act($, label, ['notice', 'read', String(event), ...(react ? [] : ['--quiet'])])
}

// 过时清扫收起的 approve 卡，你说「不对，恢复」：放回原来的状态，以后不再自动收（不用告诉主会话）。
export async function restoreReply($: Engine, id: number, label: string) {
  await act($, label, ['reply', 'unstale', String(id)])
}

// 「不用问了」：这件不做，也不再问；交给主会话告诉那件事的会话。
export async function dismissAsk($: Engine, id: number, label: string) {
  if (!(await act($, label, ['ask', 'dismiss', String(id)]))) return
  await tell($, `chief：问题 #${id} 不用问了`, label, true)
}

// 撤回刚才的回答（或「不用问了」）：问题回到等你定；主会话要是已经转告了会话，让它先别照那个做。
export async function reopenAsk($: Engine, id: number, label: string) {
  if (!(await act($, label, ['ask', 'reopen', String(id)]))) return
  await tell($, `chief：问题 #${id} 的回答撤回了`, label, true)
}

// 一张卡上剩下的都照建议办：逐个记下，再一起告诉主会话。
export async function answerAll($: Engine, ids: number[], label: string) {
  const done: number[] = []
  for (const id of ids) if (await act($, label, ['ask', 'answer', String(id)], '照建议办')) done.push(id)
  if (done.length > 0) await tell($, `chief：问题 ${done.map(id => `#${id}`).join('、')} 都照建议办`, label, true)
}

export async function setTab($: Engine, to: Tab) {
  await update($, tab, () => to)
}

export async function toggle($: Engine, key: string) {
  await update($, open, list => (list.includes(key) ? list.filter(k => k !== key) : [...list, key]))
}

export async function skipOld($: Engine, upto: number) {
  if (await act($, t().act.skipOld, ['mark', '--upto', String(upto), 'ignored'])) await act($, t().act.cursor, ['cursor', String(upto)])
}

// ── 待发出 ──

export async function setEdit($: Engine, id: number, text: string) {
  await update($, edits, x => ({ ...x, [String(id)]: text }))
}

// 发送：改过就先存改后的稿子，再排队（5 秒后引擎发出，之前能撤回）。
// typed 是输入框回车时交来的当前文字（最准）；点按钮时用记下的修改；都没有就是原稿。
export async function send($: Engine, r: ReplyRow, typed?: string) {
  if (r.kind === 'approve') {
    if (await act($, `approve ${r.target.ref ?? 'PR'}`, ['reply', 'confirm', String(r.id)], await confirmFromPanel($))) {
      await update($, note, () => stamp(t().act.approveIn(r.target.ref ?? 'PR')))
    }
    return
  }
  const text = (typed ?? (await read($, edits))[String(r.id)] ?? r.body).trim()
  if (text === '') {
    await update($, note, () => stamp(t().act.empty))
    return
  }
  const edited = text !== r.body.trim()
  if (edited) {
    // 你自己改的稿子带上钥匙（edit-yours）：引擎照原样收，不按「不许写 chief 编号」去拦你自己写的话。
    if (!(await act($, t().act.saveEdit, ['reply', 'edit-yours', String(r.id)], await editFromPanel($, text)))) return
  }
  // 你在面板上点的发送：插件带钥匙以你的名义发（主会话没有钥匙，发不了 confirmed by 你）。
  if (await act($, t().reply.reply(r.context.who ?? r.context.where), ['reply', 'confirm', String(r.id)], await confirmFromPanel($))) {
    await update($, edits, e => {
      const rest = { ...e }
      delete rest[String(r.id)]
      return rest
    })
    await update($, note, () => stamp(t().act.sendIn(r.context.who ?? r.context.where)))
    // 你改过稿子才发：让主会话看看你改了什么，提议一条写法规矩，下次写得更像你。
    if (edited) void submitOnce($, `chief：回复 #${r.id} 你改过再发的`)
  }
}

export async function redo($: Engine, r: ReplyRow, feedback: string) {
  if (!(await act($, t().act.redo, ['reply', 'redo', String(r.id)], feedback))) return
  await tell($, `chief：回复 #${r.id} 重写：${feedback}`, t().act.redoNote)
}

// ── 事情 ──

export async function finish($: Engine, t: ThingRow, how: 'done' | 'dropped') {
  if (how === 'done') {
    await act($, t_().act.done(short(t.title, 20)), ['thing', 'update', String(t.id), '--status', 'done'], '你标了办完')
    return
  }
  // 不做了：会话里可能还在干，让主会话去叫停。
  await tell($, `chief：事情 #${t.id} 不做了（${t.title}）`, t_().act.drop)
}

// 稍后再说：until 是 chief 认的写法（2h、tomorrow 09:00、next monday 09:00），到点引擎叫醒它、交给主会话。
export async function snooze($: Engine, t: ThingRow, until: string, label: string) {
  await act($, t_().act.snooze(short(t.title, 20), label), ['thing', 'snooze', String(t.id), '--until', until])
}

export async function wake($: Engine, t: ThingRow) {
  await act($, t_().act.wake(short(t.title, 20)), ['thing', 'wake', String(t.id)])
}

// ── 撤回、找以前的事 ──

export async function undo($: Engine, id: number) {
  await act($, t().act.undo, ['undo', String(id)])
}

// 搜以前的事：结果放在 found 里，进度页上画出来。
export async function search($: Engine, q: string) {
  const bin = `${await chiefDir($)}/bin/chief`
  const out = await $.process.run([bin, 'search', '--limit', '20', '--', q])
  const hits = out.exitCode !== 0 ? [] : out.stdout.split('\n').flatMap(l => {
    try {
      return l.trim() ? [JSON.parse(l) as SearchHit] : []
    } catch {
      return []
    }
  })
  await update($, found, () => ({ q, hits, ...(out.exitCode !== 0 ? { error: short(out.stderr.trim() || t().noReason, 120) } : {}) }))
}

export async function clearSearch($: Engine) {
  await update($, found, () => null)
}

// ── 策略 ──
// 放宽发送的改动带钥匙（--yours）：你在面板上改的直接生效；主会话不带钥匙改的只会变成提议。

// target：内置场景名（slack_dm），或你加的情况 custom:<号>。
export async function setScenario($: Engine, target: string, field: 'handle' | 'reply', value: Handle | ReplyMode) {
  await act($, t().act.setScenario, ['rules', '--yours', 'set', target, `${field}=${value}`], await rulesFromPanel($))
}

export async function addCustom($: Engine, when: string) {
  await act($, t().act.addCustom, ['rules', 'custom', 'add'], when)
}

export async function removeCustom($: Engine, id: number) {
  await act($, t().act.removeCustom, ['rules', 'custom', 'remove', String(id)])
}

// 钥匙换过的提醒：你点了知道了才收起（记在插件自己的存储里）。
export async function ackKeyAlerts($: Engine, upto: string) {
  await $.store.set('keyAck', upto)
  await refresh($)
}

// ── 控制 ──

export async function engineDo($: Engine, what: 'stop' | 'start' | 'restart') {
  await act($, t().act.engine[what], ['engine', what])
}

export async function hubStop($: Engine) {
  await act($, t().act.hubStop, ['hub', 'stop'])
}

export async function testMessage($: Engine, text: string) {
  await act($, t().act.test, ['test', '--from', '测试同事'], text)
}

export async function showLogs($: Engine) {
  const bin = `${await chiefDir($)}/bin/chief`
  const out = await $.process.run([bin, 'logs'])
  await update($, logs, () => (out.exitCode === 0 ? out.stdout : out.stderr).trim().split('\n').slice(-25).join('\n'))
}

export async function setBrief($: Engine, scenario: string, text: string) {
  await act($, t().act.brief, ['rules', 'brief', scenario], text)
}

export async function trust($: Engine, who: string, add: boolean) {
  await act($, t().act.trust(add), ['rules', '--yours', 'trust', add ? 'add' : 'remove'], await rulesFromPanel($, who))
}

// 「一定问我」名单：加是收紧，直接改；删是放宽，带钥匙。
export async function askAlways($: Engine, who: string, add: boolean) {
  await act($, t().act.always(add), ['rules', '--yours', 'always', add ? 'add' : 'remove'], await rulesFromPanel($, who))
}

export async function addQuick($: Engine, text: string) {
  await act($, t().act.addQuick, ['rules', '--yours', 'quick', 'add'], await rulesFromPanel($, text))
}

export async function removeQuick($: Engine, text: string) {
  await act($, t().act.removeQuick, ['rules', 'quick', 'remove'], text)
}

export async function addStyle($: Engine, text: string) {
  await act($, t().act.addStyle, ['rules', 'style', 'add'], text)
}

export async function removeStyle($: Engine, text: string) {
  await act($, t().act.removeStyle, ['rules', 'style', 'remove'], text)
}

export async function setPlacement($: Engine, audience: string, place: 'inline' | 'thread') {
  await act($, t().act.placement, ['rules', 'place', `${audience}=${place}`])
}

export async function setSignature($: Engine, text: string) {
  await act($, t().act.signature, ['rules', '--yours', 'sign'], await rulesFromPanel($, text))
}

export async function addRule($: Engine, text: string) {
  await act($, t().act.addRule, ['rules', 'add'], text)
}

export async function removeRule($: Engine, text: string) {
  await act($, t().act.removeRule, ['rules', 'remove'], text)
}

export async function decideProposal($: Engine, id: number, accept: boolean) {
  await act($, t().act.accept(accept), ['rules', '--yours', accept ? 'accept' : 'reject', String(id)], await rulesFromPanel($))
}

// ── 语言 ──

// 改界面语言：写进 config.json（chief config set locale），面板重读时换过来；引擎的通知、主会话下次醒来也跟着换。
export async function setLanguage($: Engine, to: Locale) {
  await act($, t().act.language, ['config', 'set', 'locale', to])
}

// ── 测评 ──

// ── 演练 ──

export async function runEvals($: Engine) {
  await act($, t().act.drill, ['eval', 'run'])
}

export async function saveCase($: Engine, event: number, expect: string) {
  await act($, t().act.saveCase, ['eval', 'from-event', String(event), expect])
}

export async function removeCase($: Engine, id: number) {
  await act($, t().act.removeCase, ['eval', 'remove', String(id)])
}

export async function markRight($: Engine, event: number) {
  await act($, t().act.review(event), ['review', String(event), 'ok'])
}

// 标错：记下你说的应该怎样，再让主会话据此提议一条规矩（在「要你」页等你采纳）。
export async function markWrong($: Engine, event: number, should: string) {
  if (!(await act($, t().act.review(event), ['review', String(event), 'wrong'], should))) return
  await tell($, `chief：判断 #${event} 错了：${should}`, t().act.correct)
}

// 用系统的预览打开回复附的图。只开 chief 自己存进 drafts/images 的文件，别的路径不碰。
export async function openImage($: Engine, file: string) {
  const dir = `${await chiefDir($)}/drafts/images/`
  if (!file.startsWith(dir) || file.split('/').includes('..')) {
    await $.ui.toast(t().act.imageOutside)
    return
  }
  const out = await $.process.run(['open', file]).catch(() => null)
  if (out?.exitCode !== 0) await $.ui.toast(t().act.imageGone)
}
