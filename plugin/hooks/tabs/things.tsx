// 「进度」页：最上面一张状态表（每个阶段几件；每件事一行：阶段、标记、标题、在哪讨论过、关联的需求和 PR、会话），点一行展开看每处讨论、下一步、卡在哪、结果；
// 搜以前的事；稍后再说的、办完的；
// 最近 7 天它做了什么（判断、发出的回复、能撤回的），判断错了在这里说（timeline.tsx）。只看，要你动手的在「要你」页。
import type { EngineInterface as Engine, RenderChildren } from 'claude-code'

import type { SearchHit, Snapshot, ThingRow } from '../../types'
import { clearSearch, finish, openSession, search, setTab, snooze, tell, toggle, wake } from '../actions'
import { flagBadges, linkProblem, stageBadge, stageOrder, stageSummary, tagsRow, talksList } from '../tags'
import { stylesSample } from '../samples'
import { timeline } from './timeline'
import { t as dict } from '../i18n'
import { ago, annotateBox, annotateButton, awake, daysLeft, gist, live, md, short, snoozed, startOfToday, wakeLabel, type Els } from '../ui'

// 稍后再说的几个快捷选项：until 是 chief thing snooze 认的写法。
// 名字在 i18n.ts 的 things.later / laterSay 里。
const LATER = [
  { key: '2h', until: '2h' },
  { key: 'tm', until: 'tomorrow 09:00' },
  { key: 'mon', until: 'next monday 09:00' },
] as const

// 搜出来的链接只认普通的网址，再放进 Markdown。
const SAFE_URL = /^https?:\/\/[^\s()<>[\]]+$/

export function thingsTab($: Engine, ui: Els, s: Snapshot, opened: string[], found: { q: string; hits: SearchHit[]; error?: string } | null = null) {
  const { Box, Text, Button } = ui
  const T = dict()
  const w = T.things
  const dayStart = startOfToday()
  // 稍后再说的不算在做：收在下面「稍后再说」里。
  const active = s.things.filter(awake)
  const later = s.things.filter(snoozed).sort((a, b) => (a.snooze?.until ?? '').localeCompare(b.snooze?.until ?? ''))
  const laterOpen = opened.includes('later-list')
  const act = (t: ThingRow) => (t.session ? s.activity[t.session] : undefined)
  // 最后有动静的时间：chief 记的进展，和会话里你自己推进的，取晚的那个。
  const touched = (t: ThingRow) => {
    const a = act(t)?.at
    return a && a > t.updatedAt ? a : t.updatedAt
  }
  const staleDays = (t: ThingRow) => Math.floor((Date.now() - Date.parse(touched(t))) / 86_400_000)
  // 会话里最新说的话（它说话的时间比 chief 记的进展新时才算「最新」；收到消息不算说话）。
  const live_ = (t: ThingRow) => {
    const a = act(t)
    const said = a?.saidAt ?? a?.at
    return a && a.last && said && said > t.updatedAt ? { ...a, at: said } : null
  }
  // 「最近」：chief 记的进展和会话最新说的话，取新的那个，带上时间。每张卡都有这一行。
  const latest = (t: ThingRow): { when: string; text: string; fromSession: boolean } => {
    const f = live_(t)
    if (f) return { when: ago(f.at), text: gist(f.last, 90), fromSession: true }
    return { when: ago(t.updatedAt), text: t.progress || w.noReport, fromSession: false }
  }
  // 会话是「跳过权限」模式而主会话不是：主会话发过去的消息会被扣住。
  const bypass = (t: ThingRow) => {
    const m = act(t)?.permissionMode
    return m !== undefined && m !== null && s.hubMode !== null && (m === 'bypassPermissions') !== (s.hubMode === 'bypassPermissions')
  }

  // 这件事现在是什么状态：一个标签。要你留意的（会话等你点、过期和快到期、卡住）排前面、带颜色；
  // 等你定的问题在「要你」页，这里只给个跳过去的标签；其余是在做 / 等别人 / 几天没动静。
  type Chip = { rank: number; label: string; color?: 'error' | 'warning'; hot: boolean }
  const asksOf = (t: ThingRow) => s.asks.filter(a => a.thing === t.id && a.status === 'open').length
  const chip = (t: ThingRow): Chip => {
    if (act(t)?.waiting) return { rank: 0, label: w.sessionWaiting, color: 'error', hot: true }
    if (t.due !== undefined) {
      const n = daysLeft(t.due)
      if (n < 0) return { rank: 1, label: w.overdue(-n), color: 'error', hot: true }
      if (n === 0) return { rank: 2, label: w.dueToday, color: 'error', hot: true }
      if (n === 1) return { rank: 3, label: w.dueTomorrow, color: 'warning', hot: true }
      if (n === 2) return { rank: 4, label: w.dueAfter, color: 'warning', hot: true }
    }
    if (t.blocker) return { rank: 5, label: w.blocked, color: 'error', hot: true }
    if (asksOf(t) > 0) return { rank: 6, label: w.waitingYou, color: 'warning', hot: false }
    if (staleDays(t) >= 3) return { rank: 7, label: w.stale(staleDays(t)), hot: false }
    if (t.status === 'waiting_others') return { rank: 8, label: w.waitingOthers, hot: false }
    return { rank: 9, label: w.doing, hot: false }
  }
  // 状态表的顺序：按阶段从前到后（没阶段的最后）；同一阶段里要你留意的在前，再按最近有动静的。
  const sorted = [...active].sort((a, b) => stageOrder(s, a) - stageOrder(s, b) || Number(chip(b).hot) - Number(chip(a).hot) || touched(b).localeCompare(touched(a)))
  const hot = sorted.filter(t => chip(t).hot)
  const done = s.things.filter(t => !live(t) && Date.parse(t.updatedAt) >= dayStart - 6 * 86_400_000).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const doneOpen = opened.includes('done-list')

  const goSession = (t: ThingRow) => openSession($, t.session ?? '', t.title)

  // 稍后再说：三个快捷选项。
  const laterChoices = (t: ThingRow) => (
    <Box flexDirection="row" gap="sm" flexWrap="wrap" alignItems="center">
      <Text size="footnote" dimColor>{w.laterWhen}</Text>
      {LATER.map(c => (
        <Button key={`sn${c.key}-${t.id}`} onPress={() => { void toggle($, `sn-${t.id}`); void snooze($, t, c.until, w.laterSay[c.key]) }}>{w.later[c.key]}</Button>
      ))}
    </Box>
  )

  // 状态表的一行：阶段、标记、标题（点开 / 收起），右边多久以前有动静和截止；第二行标签；第三行一句最近的（会话等你答、卡住的写那个）。
  // 点开：每处讨论、下一步、现在、结果，和操作（常用的两个在外面，其余在 ⋯ 里）。会话在等你回答的，不点开也给「去回答」。
  const row = (t: ThingRow) => {
    const key = `t${t.id}`
    const isOpen = opened.includes(key)
    const more = opened.includes(`more-t${t.id}`)
    const c = chip(t)
    const fresh = live_(t)
    const l = latest(t)
    const waiting = act(t)?.waiting
    const block = (label: string, body: RenderChildren) => (
      <Box flexDirection="column" gap="xs">
        <Text size="caption" weight="semibold" dimColor>{label}</Text>
        {body}
      </Box>
    )
    return (
      <Box key={key} flexDirection="column" borderStyle="round" borderColor={c.hot ? c.color ?? 'inactive' : 'inactive'} paddingX="md" paddingY="sm" gap="xs" marginTop="xs">
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm">
          <Box flexDirection="row" alignItems="center" gap="xs" flexShrink={1} flexWrap="wrap">
            {stageBadge(ui, s, t)}
            {flagBadges(ui, s, t) as never}
            <Box flexShrink={1}>
              <Button key={`tg${t.id}`} plain onPress={() => toggle($, key)}><Text weight="semibold">{`${isOpen ? '▾' : '▸'} ${short(t.title, 56)}`}</Text></Button>
            </Box>
          </Box>
          <Box flexShrink={0}><Text size="caption" dimColor>{ago(touched(t))}{t.due ? ` · ${w.dueOn(t.due)}` : ''}</Text></Box>
        </Box>
        {tagsRow($, ui, s, t)}
        {waiting
          ? <Text size="footnote" color="error" wrap="wrap"><Text dimColor>{w.asksYou}</Text>{waiting}</Text>
          : t.blocker
            ? <Text size="footnote" color="error" wrap="wrap">{w.blockedOn(t.blocker)}</Text>
            : !isOpen && <Text size="footnote" dimColor wrap="truncate-end">{l.text}{l.fromSession ? w.fromSession : ''}</Text>}
        {isOpen && (
          <Box flexDirection="column" gap="md" marginTop="xs">
            {talksList($, ui, s, t)}
            {/* 会话自己说的比主会话记的新：会话的话更准，放前面；主会话记的标明是它记的、可能过时。 */}
            {fresh && block(w.sessionSaid(ago(fresh.at)), md(ui, fresh.last))}
            {block(w.next, <Text size="footnote" wrap="wrap">{t.next ?? w.unclear}</Text>)}
            {t.progress && block(fresh ? w.hubNoted(ago(t.updatedAt)) : w.nowLabel, <Text size="footnote" dimColor={fresh !== null} wrap="wrap">{t.progress}</Text>)}
            {(t.results ?? []).length > 0 && block(w.results, <Box flexDirection="column">{(t.results ?? []).map((r, i) => <Box key={`rs${t.id}-${i}`}>{md(ui, r)}</Box>)}</Box>)}
            {asksOf(t) > 0 && <Box flexDirection="row"><Button key={`ti${t.id}`} plain onPress={() => setTab($, 'now')}>{w.toInbox(asksOf(t))}</Button></Box>}
            {bypass(t) && <Text size="caption" color="warning" wrap="wrap">{w.bypass}</Text>}
          </Box>
        )}
        {(isOpen || waiting) && (
          <Box flexDirection="row" gap="sm" flexWrap="wrap" alignItems="center">
            {t.session && <Button key={`ot${t.id}`} variant="primary" onPress={() => goSession(t)}>{waiting ? w.answer : w.goSession}</Button>}
            <Button key={`dn${t.id}`} onPress={() => finish($, t, 'done')}>{w.done}</Button>
            <Button key={`mo${t.id}`} plain onPress={() => toggle($, `more-t${t.id}`)}>{more ? T.less : T.more}</Button>
            {more && t.session && <Button key={`aask${t.id}`} onPress={() => tell($, `chief：转告事情 #${t.id}：现在进展怎么样？还差什么，能不能按时完成？`, w.askProgress)}>{w.askProgress}</Button>}
            {more && <Button key={`sl${t.id}`} onPress={() => toggle($, `sn-${t.id}`)}>{w.laterButton}</Button>}
            {more && annotateButton($, ui, `t${t.id}`, opened)}
            {more && <Button key={`dr${t.id}`} onPress={() => finish($, t, 'dropped')}>{w.drop}</Button>}
          </Box>
        )}
        {opened.includes(`sn-${t.id}`) && laterChoices(t)}
        {annotateBox($, ui, `t${t.id}`, `【事情 #${t.id} ${t.title}】`, opened)}
      </Box>
    )
  }

  // 搜出来的：是什么、哪天、对上的那段；有链接给链接，有会话能跳过去。
  const hitRow = (hit: SearchHit, i: number) => (
    <Box key={`sh${i}`} flexDirection="column">
      <Text size="caption" dimColor wrap="truncate-end">{w.hit[hit.kind]} · {hit.date.slice(0, 10)}{hit.archived ? w.archived : ''} · {short(hit.title, 40)}</Text>
      <Text size="footnote" wrap="wrap">{hit.snippet}</Text>
      {((hit.url && SAFE_URL.test(hit.url)) || hit.session) && (
        <Box flexDirection="row" gap="sm" alignItems="center">
          {hit.url && SAFE_URL.test(hit.url) && md(ui, `[${w.openLink}](${hit.url})`)}
          {hit.session && <Button key={`shs${i}`} plain onPress={() => openSession($, hit.session ?? '', hit.title)}>{w.toSession}</Button>}
        </Box>
      )}
    </Box>
  )

  // 收起来的一段：▸ 标题 · 数量，点开才画内容。
  const fold = (key: string, isOpen: boolean, title: string, body: RenderChildren) => (
    <Box flexDirection="column">
      <Box marginTop="lg" marginBottom="xs">
        <Button key={key} plain onPress={() => toggle($, key)}>{`${isOpen ? '▾' : '▸'} ${title}`}</Button>
      </Box>
      {isOpen && <Box flexDirection="column" borderStyle="round" borderColor="inactive" paddingX="md" paddingY="sm" gap="xs">{body}</Box>}
    </Box>
  )


  return (
    <Box flexDirection="column" marginTop="sm">
      {stylesSample(ui, s)}
      {linkProblem(s) !== null && <Text size="caption" color="warning" wrap="wrap">{T.tags.linkErrors(linkProblem(s)!)}</Text>}
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap="sm">
        <Text size="caption" dimColor>{w.summary(active.length, hot.length, done.length)}</Text>
        <Button key="progress" plain onPress={() => tell($, 'chief：问一遍各事情的最新进展', w.askProgress)}>{w.askAll}</Button>
      </Box>

      {'Input' in ui && (
        <Box width="100%" marginTop="sm">
          <ui.Input key="search" placeholder={w.searchPlaceholder} submitLabel={w.search}
            onSubmit={(v: string) => { if (v.trim()) void search($, v.trim()) }} />
        </Box>
      )}
      {found && (
        <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX="md" paddingY="sm" gap="sm" marginTop="sm">
          <Box flexDirection="row" justifyContent="space-between" alignItems="center">
            <Text weight="semibold">{w.found(short(found.q, 20), found.hits.length)}</Text>
            <Button key="search-clear" plain onPress={() => clearSearch($)}>✕</Button>
          </Box>
          {found.error && <Text size="footnote" color="error" wrap="wrap">{w.searchFailed(found.error)}</Text>}
          {!found.error && found.hits.length === 0 && <Text size="footnote" dimColor>{w.notFound}</Text>}
          {found.hits.map(hitRow)}
        </Box>
      )}

      {active.length === 0 && <Box marginTop="sm"><Text dimColor>{w.none}</Text></Box>}
      {active.length > 0 && <Box marginTop="md" marginBottom="xs">{stageSummary(ui, s, active)}</Box>}
      {sorted.map(row)}

      {done.length > 0 && (
        <Box flexDirection="column">
          <Box marginTop="lg" marginBottom="xs">
            <Button key="done-list" plain onPress={() => toggle($, 'done-list')}>{`${doneOpen ? '▾' : '▸'} ${w.doneList(done.length)}`}</Button>
          </Box>
          {doneOpen && (
            <Box flexDirection="column" borderStyle="round" borderColor="inactive" paddingX="md" paddingY="sm" gap="xs">
              {done.map(t => <Text key={`dd${t.id}`} size="footnote" wrap="truncate-end"><Text color="success">✓ </Text>{t.title}</Text>)}
            </Box>
          )}
        </Box>
      )}

      {later.length > 0 && fold('later-list', laterOpen, w.laterList(later.length), later.map(t => (
        <Box key={`lt${t.id}`} flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm">
          <Box flexGrow={1} flexShrink={1}>
            <Text size="footnote" wrap="truncate-end">{t.title}<Text dimColor>{w.wakeAt(wakeLabel(t.snooze?.until ?? ''))}</Text></Text>
          </Box>
          <Button key={`wk${t.id}`} onPress={() => wake($, t)}>{w.wakeNow}</Button>
        </Box>
      )))}

      {timeline($, ui, s, opened)}
    </Box>
  )
}
