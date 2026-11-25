// 事情的阶段、标记和标签：进度页的状态表、要你页的事情卡都用这里。
//   阶段：计划中 → 方案中 → 开发中 → 用例评审中 → 测试中 → 待发布 → 已上线（换算规则在 engine/src/shared/stage.ts）。
//   标记：卡住、暂停、过期 / 快到期、会话在等你回答、等你定，叠在阶段旁边。
//   标签三类，都能点：在哪讨论过（💬 Slack、🎫 Jira、🔀 GitHub、📄 Notion，一个渠道一个，点开最近一条消息）、
//   关联的需求和 PR（带状态）、🧵 会话（跳过去）。数据在 links.json（引擎每 10 分钟查一次）。
// 颜色只用边框和按钮外面的字：App 把按钮里的字一律画成同一个颜色，放进按钮的颜色会丢。
import type { EngineInterface as Engine } from 'claude-code'

import { STAGES, STAGE_LABELS, STAGE_TONE, jiraStage, parseStage, prStage, stageOf, ticketKeysIn, type Stage } from '../engine/src/shared/stage'
import type { JiraLink, PrLink, Snapshot, TalkLink, ThingRow } from '../types'
import { openSession, openUrl } from './actions'
import { locale, sourceName, t } from './i18n'
import { ago, daysLeft, short, type Els } from './ui'

const JIRA_KEY = /^[A-Z][A-Z0-9]{1,9}-\d{1,7}$/
const PR_KEY = /^github\.com\/([\w.-]{1,100})\/([\w.-]{1,100})\/pull\/(\d{1,9})$/
// 一行最多几个需求、几个 PR 标签，多的收成「+N」（展开卡片里看全部）。
const MAX_REQ = 2
const MAX_PR = 3
// 查不成连着超过这么久才在面板上提醒（偶尔慢一次不报）。
const FAIL_NOTICE_MS = 30 * 60_000

export type Tone = 'error' | 'warning' | 'success' | 'suggestion' | 'merged' | 'inactive'

const STAGE_COLOR: Record<(typeof STAGE_TONE)[Stage], Tone> = { idle: 'inactive', build: 'suggestion', qa: 'warning', ship: 'merged', done: 'success' }

export const SOURCE_ICON: Record<string, string> = { slack: '💬', jira: '🎫', github: '🔀', notion: '📄', session: '🧵' }

// 这件事挂的需求：键里的和标题里写的 Jira 单号，子任务换成它的父单（需求），去重；查到了的排前面，Story 排最前。
export function requirementsOf(s: Snapshot, th: ThingRow): { key: string; link: JiraLink | null }[] {
  const seen = new Set<string>()
  const out: { key: string; link: JiraLink | null }[] = []
  for (const k of [...(th.keys ?? []).filter(x => JIRA_KEY.test(x)), ...ticketKeysIn(th.title)]) {
    const own = s.links.jira[k]
    const key = own?.parent && s.links.jira[own.parent] ? own.parent : k
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ key, link: s.links.jira[key] ?? null })
  }
  const rank = (x: { link: JiraLink | null }) => (x.link === null ? 2 : /story|epic|需求/i.test(x.link.type ?? '') ? 0 : 1)
  return out.sort((a, b) => rank(a) - rank(b))
}

export function prsOf(s: Snapshot, th: ThingRow): { key: string; pr: PrLink | null }[] {
  const keys = (th.keys ?? []).filter(k => PR_KEY.test(k))
  // 开着的排前面（要你留意的多半是它们）。
  const order = (k: string) => (s.links.prs[k]?.state === 'open' || !s.links.prs[k] ? 0 : 1)
  return [...keys].sort((a, b) => order(a) - order(b)).map(key => ({ key, pr: s.links.prs[key] ?? null }))
}

// 阶段和暂停：需求的 Jira 状态、会话汇报的、PR 推断的，按 stageOf 合起来。
export function thingStage(s: Snapshot, th: ThingRow): { stage: Stage | null; paused: boolean } {
  const req = requirementsOf(s, th).find(r => r.link !== null)?.link ?? null
  const fromJira = req ? jiraStage(req.status, req.category) : null
  const reported = th.stage ? parseStage(th.stage.id) : null
  const pr = prStage(prsOf(s, th).flatMap(x => (x.pr ? [x.pr] : [])))
  return stageOf(fromJira, reported, pr)
}

export function stageLabel(st: Stage): string {
  return STAGE_LABELS[locale()][st]
}

export function stageTone(st: Stage): Tone {
  return STAGE_COLOR[STAGE_TONE[st]]
}

// 有边框的小块：阶段、标记用（不能点，字的颜色画得出来）。
export function badge(ui: Els, key: string, text: string, tone: Tone, strong = true) {
  const { Box, Text } = ui
  return (
    <Box key={key} borderStyle="round" borderColor={tone} paddingX="sm" flexShrink={0}>
      <Text size="caption" weight={strong ? 'semibold' : undefined} color={tone === 'inactive' ? undefined : tone} dimColor={tone === 'inactive'}>{text}</Text>
    </Box>
  )
}

export function stageBadge(ui: Els, s: Snapshot, th: ThingRow) {
  const { stage } = thingStage(s, th)
  return stage === null ? badge(ui, `stg${th.id}`, '—', 'inactive', false) : badge(ui, `stg${th.id}`, stageLabel(stage), stageTone(stage))
}

// 叠在阶段旁边的标记：会话在等你回答、过期 / 快到期、卡住、暂停、等你定。
export function flagsOf(s: Snapshot, th: ThingRow): { key: string; text: string; tone: Tone }[] {
  const w = t().things
  const out: { key: string; text: string; tone: Tone }[] = []
  const act = th.session ? s.activity[th.session] : undefined
  if (act?.waiting) out.push({ key: 'wait', text: w.sessionWaiting, tone: 'error' })
  if (th.due !== undefined) {
    const n = daysLeft(th.due)
    if (n < 0) out.push({ key: 'due', text: w.overdue(-n), tone: 'error' })
    else if (n === 0) out.push({ key: 'due', text: w.dueToday, tone: 'error' })
    else if (n <= 2) out.push({ key: 'due', text: n === 1 ? w.dueTomorrow : w.dueAfter, tone: 'warning' })
  }
  if (th.blocker) out.push({ key: 'blk', text: w.blocked, tone: 'error' })
  if (thingStage(s, th).paused) out.push({ key: 'pause', text: t().tags.paused, tone: 'inactive' })
  if (s.asks.some(a => a.thing === th.id && a.status === 'open')) out.push({ key: 'ask', text: w.waitingYou, tone: 'warning' })
  return out
}

export function flagBadges(ui: Els, s: Snapshot, th: ThingRow) {
  return flagsOf(s, th).map(f => badge(ui, `flg${th.id}-${f.key}`, f.text, f.tone))
}

// 能点的标签：有颜色的边框，里面是按钮。点不开的（没查到地址）只有边框和淡字。
export function pill(ui: Els, key: string, text: string, tone: Tone, onPress: (() => void) | null) {
  const { Box, Text, Button } = ui
  return (
    <Box key={`${key}-box`} borderStyle="round" borderColor={tone} paddingX="sm" flexShrink={0}>
      {onPress
        ? <Button key={key} plain onPress={onPress}><Text size="caption">{text}</Text></Button>
        : <Text size="caption" dimColor>{text}</Text>}
    </Box>
  )
}

function prText(key: string, pr: PrLink | null): { text: string; tone: Tone } {
  const w = t().tags
  const n = PR_KEY.exec(key)?.[3] ?? '?'
  if (pr === null) return { text: `🔀 #${n}`, tone: 'inactive' }
  const state = pr.state !== 'open' ? w.prState[pr.state] : pr.draft ? w.prState.draft : pr.review ? w.prState[pr.review] : w.prState.open
  const ci = pr.state === 'open' && pr.ci ? ` · ${w.ci[pr.ci]}` : ''
  const tone: Tone = pr.state === 'merged' ? 'success' : pr.state === 'closed' ? 'inactive' : pr.ci === 'fail' || pr.review === 'changes' ? 'error' : pr.review === 'approved' ? 'success' : 'warning'
  return { text: `🔀 #${n} ${state}${ci}`, tone }
}

function reqText(r: { key: string; link: JiraLink | null }): { text: string; tone: Tone } {
  if (r.link === null) return { text: `🎫 ${r.key}`, tone: 'inactive' }
  const st = jiraStage(r.link.status, r.link.category)
  if (st === 'hold') return { text: `🎫 ${r.key} ${t().tags.paused}`, tone: 'inactive' }
  return st ? { text: `🎫 ${r.key} ${stageLabel(st)}`, tone: stageTone(st) } : { text: `🎫 ${r.key} ${r.link.status}`, tone: 'inactive' }
}

// 在哪讨论过，按渠道合成一个标签：一处就写它的名字（💬 #proj-rtc），几处写「💬 Slack · 2 处」；点开那个渠道最近的一条。
export function talkGroups(s: Snapshot, th: ThingRow): { source: string; talks: TalkLink[] }[] {
  const by = new Map<string, TalkLink[]>()
  for (const x of s.links.talks[String(th.id)] ?? []) by.set(x.source, [...(by.get(x.source) ?? []), x])
  return [...by.entries()].map(([source, talks]) => ({ source, talks }))
}

const iconOf = (source: string) => SOURCE_ICON[source] ?? '•'

// 一行标签：讨论渠道、需求、PR、会话。
export function tagsRow($: Engine, ui: Els, s: Snapshot, th: ThingRow) {
  const { Box, Text } = ui
  const w = t().tags
  const chips: unknown[] = []

  for (const g of talkGroups(s, th)) {
    const latest = g.talks.find(x => x.url) ?? null
    const text = g.talks.length === 1 ? `${iconOf(g.source)} ${short(g.talks[0]!.label, 20)}` : `${iconOf(g.source)} ${sourceName(g.source)} · ${w.places(g.talks.length)}`
    chips.push(pill(ui, `tk${th.id}-${g.source}`, text, 'inactive', latest?.url ? () => void openUrl($, latest.url!, text) : null))
  }

  const reqs = requirementsOf(s, th)
  for (const r of reqs.slice(0, MAX_REQ)) {
    const { text, tone } = reqText(r)
    const url = r.link?.url ?? (s.links.jiraSite ? `https://${s.links.jiraSite}/browse/${r.key}` : null)
    chips.push(pill(ui, `jr${th.id}-${r.key}`, text, tone, url ? () => void openUrl($, url, r.key) : null))
  }

  const prs = prsOf(s, th)
  for (const { key, pr } of prs.slice(0, MAX_PR)) {
    const { text, tone } = prText(key, pr)
    const m = PR_KEY.exec(key)
    const url = pr?.url || (m ? `https://github.com/${m[1]}/${m[2]}/pull/${m[3]}` : '')
    chips.push(pill(ui, `pr${th.id}-${key}`, text, tone, url ? () => void openUrl($, url, text) : null))
  }

  if (th.session) chips.push(pill(ui, `ss${th.id}`, `🧵 ${w.session}`, 'inactive', () => void openSession($, th.session ?? '', th.title)))

  const hidden = Math.max(0, reqs.length - MAX_REQ) + Math.max(0, prs.length - MAX_PR)
  if (hidden > 0) chips.push(<Text key={`more${th.id}`} size="caption" dimColor>{w.more(hidden)}</Text>)

  if (chips.length === 0) return null
  return <Box flexDirection="row" flexWrap="wrap" gap="xs" alignItems="center">{chips as never}</Box>
}

// 展开卡片里：每一处讨论一行（渠道、名字、几条、多久以前，点开），下面一行最近说了什么；再列全部需求和 PR。
export function talksList($: Engine, ui: Els, s: Snapshot, th: ThingRow) {
  const { Box, Text, Button } = ui
  const w = t().tags
  const talks = s.links.talks[String(th.id)] ?? []
  const reqs = requirementsOf(s, th)
  const prs = prsOf(s, th)
  if (talks.length === 0 && reqs.length <= MAX_REQ && prs.length <= MAX_PR) return null
  return (
    <Box flexDirection="column" gap="xs">
      {talks.length > 0 && <Text size="caption" weight="semibold" dimColor>{w.talkedIn}</Text>}
      {talks.map((x, i) => {
        const head = `${iconOf(x.source)} ${sourceName(x.source)} · ${short(x.label, 30)}${x.count > 0 ? ` · ${w.msgs(x.count)}` : ''} · ${ago(x.lastAt)}${x.first ? ` · ${w.first}` : ''}`
        return (
          <Box key={`tl${th.id}-${i}`} flexDirection="column">
            {x.url
              ? <Button key={`tlb${th.id}-${i}`} plain onPress={() => void openUrl($, x.url!, x.label)}><Text size="footnote">{head} ↗</Text></Button>
              : <Text size="footnote">{head}</Text>}
            {x.said !== '' && <Box paddingLeft="md"><Text size="caption" dimColor wrap="truncate-end">{x.said}</Text></Box>}
          </Box>
        )
      })}
      {(reqs.length > MAX_REQ || prs.length > MAX_PR) && (
        <Box flexDirection="row" flexWrap="wrap" gap="xs" marginTop="xs">
          {reqs.slice(MAX_REQ).map(r => {
            const { text, tone } = reqText(r)
            const url = r.link?.url ?? (s.links.jiraSite ? `https://${s.links.jiraSite}/browse/${r.key}` : null)
            return pill(ui, `jrx${th.id}-${r.key}`, text, tone, url ? () => void openUrl($, url, r.key) : null)
          }) as never}
          {prs.slice(MAX_PR).map(({ key, pr }) => {
            const { text, tone } = prText(key, pr)
            return pill(ui, `prx${th.id}-${key}`, text, tone, pr?.url ? () => void openUrl($, pr.url, text) : null)
          }) as never}
        </Box>
      )}
    </Box>
  )
}

// 状态表最上面一行：每个阶段几件（没有的淡），再加卡住、暂停几件。
export function stageSummary(ui: Els, s: Snapshot, things: readonly ThingRow[]) {
  const { Box } = ui
  const count = new Map<Stage | null, number>()
  let blocked = 0
  let paused = 0
  for (const th of things) {
    const st = thingStage(s, th)
    count.set(st.stage, (count.get(st.stage) ?? 0) + 1)
    if (th.blocker) blocked++
    if (st.paused) paused++
  }
  const w = t().tags
  return (
    <Box flexDirection="row" flexWrap="wrap" gap="xs" alignItems="center">
      {STAGES.map(st => {
        const n = count.get(st) ?? 0
        return badge(ui, `sum-${st}`, `${stageLabel(st)} ${n}`, n > 0 ? stageTone(st) : 'inactive', n > 0)
      }) as never}
      {(count.get(null) ?? 0) > 0 && badge(ui, 'sum-none', `${w.noStage} ${count.get(null)}`, 'inactive', false)}
      {blocked > 0 && badge(ui, 'sum-blk', `${t().things.blocked} ${blocked}`, 'error')}
      {paused > 0 && badge(ui, 'sum-pause', `${w.paused} ${paused}`, 'inactive')}
    </Box>
  )
}

// 状态表的顺序：按阶段从前到后，没阶段的最后；同一阶段里要你留意的（有标记的）在前。
export function stageOrder(s: Snapshot, th: ThingRow): number {
  const st = thingStage(s, th).stage
  return st === null ? STAGES.length : STAGES.indexOf(st)
}

// 单子、PR 连着查不成超过半小时：一句提醒（偶尔慢一次不报）。
export function linkProblem(s: Snapshot): string | null {
  const old = Object.entries(s.links.errors).filter(([k]) => {
    const since = s.links.failingSince[k]
    return since !== undefined && Date.now() - Date.parse(since) >= FAIL_NOTICE_MS
  })
  return old.length === 0 ? null : old.map(([, v]) => v).join('；')
}

// 回复卡上「原消息」：回的是哪条，能点开就给个链接。
export function messageLink($: Engine, ui: Els, s: Snapshot, event: number) {
  const { Button, Text } = ui
  const url = s.links.messages[String(event)]
  if (!url) return null
  return <Button key={`msg${event}`} plain onPress={() => void openUrl($, url, t().tags.message)}><Text size="caption" dimColor>{t().tags.message}</Text></Button>
}
