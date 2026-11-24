// 进度页的「最近」：最近 7 天它做了什么，一条时间线。
//   判断：每条消息怎么办的、为什么；点开能标对错、存成演练例子；只记下 / 忽略的能撤回。
//   发出的回复：谁让发的、发给谁。
//   你做的能撤回的：不做了、跳过积下的。
// 判断错了就在这里说：会变成规矩提议，到「要你」里等你采纳。
import type { EngineInterface as Engine } from 'claude-code'

import { expectOf } from '../../engine/src/shared/rules'
import type { DecisionRow, ReplyRow, Snapshot, UndoRow } from '../../types'
import { markRight, markWrong, saveCase, toggle, undo } from '../actions'
import { L, t } from '../i18n'
import { ago, scenarioName, select, short, verdictName, whatOf, type Els } from '../ui'
import { whoSent } from './outbox'

type Item = { at: string; d?: DecisionRow; r?: ReplyRow; u?: UndoRow }

const SHOW = 10
const MORE = 60

export function timelineItems(s: Snapshot): Item[] {
  const since = Date.now() - 7 * 86_400_000
  const items: Item[] = [
    ...s.decisions.map(d => ({ at: d.at, d })),
    ...s.replies.filter(r => r.status === 'sent' && r.sentAt !== undefined && Date.parse(r.sentAt) >= since).map(r => ({ at: r.sentAt!, r })),
    // 只记下 / 忽略的撤回挂在那条判断上；这里是别的（不做了、跳过积下的）。
    ...s.undo.filter(u => u.kind !== 'mark').map(u => ({ at: u.at, u })),
  ]
  return items.sort((a, b) => b.at.localeCompare(a.at))
}

export function timeline($: Engine, ui: Els, s: Snapshot, opened: string[]) {
  const { Box, Text, Button } = ui
  const w = t().eval
  const T = t().things
  const all = timelineItems(s)
  const more = opened.includes('tl-more')
  const items = all.slice(0, more ? MORE : SHOW)
  // 消息 → 那一笔能撤回的「只记下 / 忽略」。
  const markUndo = new Map<number, UndoRow>()
  for (const u of s.undo) if (u.kind === 'mark' && !u.undone) for (const e of u.events ?? []) if (!markUndo.has(e.id)) markUndo.set(e.id, u)

  const decisionRow = (d: DecisionRow) => {
    const key = `d${d.event}`
    const r = s.reviews[String(d.event)]
    const isOpen = opened.includes(key)
    const u = markUndo.get(d.event)
    return (
      <Box key={key} flexDirection="column" gap="xs" paddingY="xs">
        <Box flexDirection="row" alignItems="center" gap="xs" justifyContent="space-between">
          <Button key={`dt${d.event}`} plain onPress={() => toggle($, key)}>
            {isOpen ? '▾ ' : '▸ '}{verdictName(d.verdict)} <Text dimColor>· {scenarioName(d.scenario)} · {ago(d.at)}</Text>
            {r ? (r.ok ? ' ✓' : ' ✗') : ''}
          </Button>
          {u && <Button key={`du${d.event}`} plain onPress={() => undo($, u.id)}>{T.undo}</Button>}
        </Box>
        <Box paddingLeft="md" flexDirection="column">
          {d.what && <Text size="footnote" dimColor wrap="truncate-end">{d.what.from ? `${d.what.from}${t().colon}` : ''}{short(d.what.text, 80)}</Text>}
          <Text size="footnote" wrap="wrap">{short(d.reason, isOpen ? 300 : 80)}</Text>
          {r && !r.ok && r.note && <Text color="error" size="caption" wrap="wrap">{w.youSaid(r.note)}</Text>}
        </Box>
        {isOpen && !r && (
          <Box flexDirection="column" paddingLeft="md" gap="xs">
            <Box flexDirection="row" gap="sm">
              <Button key={`ok-${d.event}`} onPress={() => markRight($, d.event)}>{w.right}</Button>
            </Box>
            {'Input' in ui && (
              <Box width="100%">
                <ui.Input key={`wr-${d.event}`} rows={2} placeholder={w.wrongPlaceholder} submitLabel={w.wrong} onSubmit={(v: string) => {
                  if (v.trim()) void markWrong($, d.event, v.trim())
                }} />
              </Box>
            )}
          </Box>
        )}
        {isOpen && (
          <Box flexDirection="row" gap="sm" alignItems="center" paddingLeft="md">
            <Text size="caption" dimColor>{w.saveAs}</Text>
            {select(ui, `sc-${d.event}`, r && !r.ok ? '' : expectOf(d.verdict), Object.entries(L().expect).map(([value, label]) => ({ value, label })), val => { if (val) void saveCase($, d.event, val) })}
          </Box>
        )}
      </Box>
    )
  }

  const sentRow = (r: ReplyRow) => (
    <Box key={`sent${r.id}`} paddingY="xs">
      <Text size="footnote" dimColor wrap="truncate-end">✉ {whoSent(r)} · {whatOf(r)}{r.kind === 'approve' ? '' : `${t().colon}${short(r.body, 60)}`}{t().gap}{ago(r.sentAt)}</Text>
    </Box>
  )

  const undoRow = (x: UndoRow) => (
    <Box key={`ul${x.id}`} flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm" paddingY="xs">
      <Box flexGrow={1} flexShrink={1}>
        <Text size="footnote" wrap="truncate-end" dimColor={x.undone !== undefined}>{x.label}<Text dimColor>{t().gap}{ago(x.at)}</Text></Text>
      </Box>
      {x.undone ? <Text size="caption" dimColor>{T.undone}</Text> : <Button key={`un${x.id}`} plain onPress={() => undo($, x.id)}>{T.undo}</Button>}
    </Box>
  )

  return (
    <Box flexDirection="column">
      <Box marginTop="lg" marginBottom="xs" flexDirection="column">
        <Text size="footnote" weight="semibold">{T.timeline}</Text>
        <Text size="caption" dimColor wrap="wrap">{T.timelineHelp}</Text>
      </Box>
      {all.length === 0 && <Text size="footnote" dimColor>{w.noLog}</Text>}
      {items.map(x => (x.d ? decisionRow(x.d) : x.r ? sentRow(x.r) : undoRow(x.u!)))}
      {all.length > SHOW && <Button key="tl-more" plain onPress={() => toggle($, 'tl-more')}>{more ? t().less : T.timelineMore(Math.min(all.length, MORE) - SHOW)}</Button>}
    </Box>
  )
}
