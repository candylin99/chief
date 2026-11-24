// 事情卡上的一行标签：从哪来（Slack / Jira / GitHub / 会话，点开原消息）、关联的需求（Jira 单和状态）、PR（review、CI），都能点开；
// 和标题前的阶段（方案中、开发中、QA 用例评审……）。数据在 links.json（引擎每 10 分钟查一次），阶段的换算在 engine/src/shared/stage.ts。
import type { EngineInterface as Engine } from 'claude-code'

import { STAGE_LABELS, STAGE_TONE, jiraStage, parseStage, stageOf, type Stage } from '../engine/src/shared/stage'
import type { JiraLink, PrLink, Snapshot, ThingRow } from '../types'
import { openSession, openUrl } from './actions'
import { locale, sourceName, t } from './i18n'
import { short, type Els } from './ui'

const JIRA_KEY = /^[A-Z][A-Z0-9]{1,9}-\d{1,7}$/
const PR_KEY = /^github\.com\/([\w.-]{1,100})\/([\w.-]{1,100})\/pull\/(\d{1,9})$/
// 一张卡最多几个需求、几个 PR 标签，多的收成「+N」。
const MAX_REQ = 2
const MAX_PR = 3

type Color = 'error' | 'warning' | 'success' | 'suggestion' | 'claude' | undefined

const TONE_COLOR: Record<(typeof STAGE_TONE)[Stage], Color> = { dim: undefined, active: 'claude', qa: 'warning', ship: 'suggestion', done: 'success' }

// 这件事挂的需求：Jira 子任务换成它的父单（需求），去重；查到了的排前面，Story 排最前。
export function requirementsOf(s: Snapshot, th: ThingRow): { key: string; link: JiraLink | null }[] {
  const seen = new Set<string>()
  const out: { key: string; link: JiraLink | null }[] = []
  for (const k of (th.keys ?? []).filter(x => JIRA_KEY.test(x))) {
    const own = s.links.jira[k]
    const key = own?.parent && s.links.jira[own.parent] ? own.parent : k
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ key, link: s.links.jira[key] ?? null })
  }
  const rank = (x: { link: JiraLink | null }) => (x.link === null ? 2 : /story|epic|需求/i.test(x.link.type ?? '') ? 0 : 1)
  return out.sort((a, b) => rank(a) - rank(b))
}

// 标题前的阶段：需求的 Jira 状态换算的，和汇报里写的，按 stageOf 合起来。都没有是 null。
export function thingStage(s: Snapshot, th: ThingRow): { id: Stage; label: string; color: Color } | null {
  const req = requirementsOf(s, th).find(r => r.link !== null)?.link ?? null
  const fromJira = req ? jiraStage(req.status, req.category) : null
  const reported = th.stage ? parseStage(th.stage.id) : null
  const id = stageOf(fromJira, reported)
  if (id === null) return null
  return { id, label: STAGE_LABELS[locale()][id], color: TONE_COLOR[STAGE_TONE[id]] }
}

export function stageBadge(ui: Els, s: Snapshot, th: ThingRow) {
  const { Text } = ui
  const st = thingStage(s, th)
  if (st === null) return null
  return <Text size="caption" weight="semibold" color={st.color} dimColor={st.color === undefined}>[{st.label}]{t().gap}</Text>
}

function prLabel(key: string, pr: PrLink | null): { text: string; color: Color } {
  const w = t().tags
  const n = PR_KEY.exec(key)?.[3] ?? '?'
  if (pr === null) return { text: w.pr(n), color: undefined }
  const state = pr.state !== 'open' ? w.prState[pr.state] : pr.draft ? w.prState.draft : pr.review ? w.prState[pr.review] : w.prState.open
  const ci = pr.state === 'open' && pr.ci ? ` ${w.ci[pr.ci]}` : ''
  const color: Color = pr.state === 'merged' ? 'success' : pr.state === 'closed' ? undefined : pr.ci === 'fail' || pr.review === 'changes' ? 'error' : pr.review === 'approved' ? 'success' : 'warning'
  return { text: `${w.pr(n)} · ${state}${ci}`, color }
}

// 一行标签。opts.origin 为 false 时不画「从哪来」（卡片别处已经说了来源的）。
export function tagsRow($: Engine, ui: Els, s: Snapshot, th: ThingRow, opts: { origin?: boolean } = {}) {
  const { Box, Text, Button } = ui
  const w = t().tags
  const chips: unknown[] = []
  // 点得开的是按钮，点不开的（没查到地址）是淡字。
  const chip = (key: string, text: string, color: Color, onPress: (() => void) | null) => onPress
    ? <Button key={key} plain onPress={onPress}><Text size="caption" color={color} dimColor={color === undefined}>{text} ↗</Text></Button>
    : <Text key={key} size="caption" color={color} dimColor={color === undefined}>{text}</Text>

  const o = s.links.origins[String(th.id)]
  if (opts.origin !== false && o) {
    const label = `${o.source === 'session' ? w.session : sourceName(o.source)} · ${short(o.label, 24)}`
    if (o.url) chips.push(chip(`og${th.id}`, label, undefined, () => void openUrl($, o.url!, label)))
    else if (o.source === 'session' && th.session) chips.push(chip(`og${th.id}`, label, undefined, () => void openSession($, th.session ?? '', th.title)))
    else chips.push(chip(`og${th.id}`, label, undefined, null))
  }

  const reqs = requirementsOf(s, th)
  for (const r of reqs.slice(0, MAX_REQ)) {
    const text = r.link ? `${r.key} · ${r.link.status}` : r.key
    const url = r.link?.url ?? (s.links.jiraSite ? `https://${s.links.jiraSite}/browse/${r.key}` : null)
    const st = r.link ? jiraStage(r.link.status, r.link.category) : null
    chips.push(chip(`jr${th.id}-${r.key}`, text, st ? TONE_COLOR[STAGE_TONE[st]] : undefined, url ? () => void openUrl($, url, r.key) : null))
  }

  const prs = (th.keys ?? []).filter(k => PR_KEY.test(k))
  // 开着的 PR 排前面（要你留意的多半是它们）。
  const order = (k: string) => (s.links.prs[k]?.state === 'open' || !s.links.prs[k] ? 0 : 1)
  const shown = [...prs].sort((a, b) => order(a) - order(b))
  for (const k of shown.slice(0, MAX_PR)) {
    const pr = s.links.prs[k] ?? null
    const l = prLabel(k, pr)
    const m = PR_KEY.exec(k)
    const url = pr?.url || (m ? `https://github.com/${m[1]}/${m[2]}/pull/${m[3]}` : '')
    chips.push(chip(`pr${th.id}-${k}`, l.text, l.color, url ? () => void openUrl($, url, l.text) : null))
  }
  const hidden = Math.max(0, reqs.length - MAX_REQ) + Math.max(0, prs.length - MAX_PR)
  if (hidden > 0) chips.push(<Text key={`more${th.id}`} size="caption" dimColor>{w.more(hidden)}</Text>)

  if (chips.length === 0) return null
  return <Box flexDirection="row" flexWrap="wrap" gap="sm" alignItems="center">{chips as never}</Box>
}

// 回复卡上「原消息」：回的是哪条，能点开就给个链接。
export function messageLink($: Engine, ui: Els, s: Snapshot, event: number) {
  const { Button, Text } = ui
  const url = s.links.messages[String(event)]
  if (!url) return null
  return <Button key={`msg${event}`} plain onPress={() => void openUrl($, url, t().tags.message)}><Text size="caption" dimColor>{t().tags.message}</Text></Button>
}
