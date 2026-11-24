// 「规矩」页：按你想事情的顺序——每种消息怎么办、你的规矩（引擎执行的情况 + 给主会话参考的交代）、人（白名单、一定问我）、
// 回复（写法、固定回复、放哪、署名）、它做得怎么样（准确率、演练）。它提议的规矩在「要你」页等你采纳。
import type { EngineInterface as Engine, RenderChildren } from 'claude-code'

import { DEFAULT_PLACEMENT, DEFAULT_SIGNATURE } from '../../engine/src/shared/rules'
import type { Handle, ReplyMode, Rule, Snapshot } from '../../types'
import { addCustom, addQuick, addRule, addStyle, askAlways, removeCustom, removeQuick, removeRule, removeStyle, setBrief, setPlacement, setScenario, setSignature, toggle, trust } from '../actions'
import { L, t } from '../i18n'
import { scenarioName, select, type Els } from '../ui'
import { howItDoes } from './eval'

// 下拉里的做法、回复要不要确认：名字和 chief 命令行同一份（engine/src/shared/rules.ts）。
const handles = () => Object.entries(L().handle).map(([value, label]) => ({ value: value as Handle, label }))

const modes = () => Object.entries(L().replyModeShort).map(([value, label]) => ({ value: value as ReplyMode, label }))

export function policyTab($: Engine, ui: Els, s: Snapshot, opened: string[]) {
  const { Box, Text, Button } = ui
  const w = t().policy
  const HANDLES = handles()
  const MODES = modes()
  const p = s.policy
  if (p === null) return <Text dimColor>{w.loading}</Text>
  const helpOpen = opened.includes('policy-help')

  // 一条规矩：左边是什么情况，右边两个下拉；下面一行是交代（点了才出输入框）。
  const ruleRow = (target: string, label: string, r: Rule, onRemove?: () => void) => {
    const bk = `brief-${target}`
    const editing = opened.includes(bk)
    const takesBrief = r.handle === 'dispatch' || r.handle === 'approve'
    return (
      <Box key={`sc-${target}`} flexDirection="column" gap="xs" paddingY="xs">
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm" flexWrap="wrap">
          <Box flexGrow={1} flexShrink={1} minWidth={16}><Text wrap="wrap">{label}</Text></Box>
          <Box flexDirection="row" gap="sm" alignItems="center">
            {select(ui, `h-${target}`, r.handle, target === 'slack_self' ? HANDLES : HANDLES.filter(h => h.value !== 'command'), val => void setScenario($, target, 'handle', val as Handle))}
            {r.handle !== 'ignore' && r.handle !== 'note' && select(ui, `m-${target}`, r.reply, MODES, val => void setScenario($, target, 'reply', val as ReplyMode))}
          </Box>
        </Box>
        {takesBrief && (
          <Box flexDirection="row" gap="sm" alignItems="center">
            {r.brief
              ? <Text size="footnote" dimColor wrap="wrap">{w.brief(r.brief)}</Text>
              : null}
            <Button key={`eb-${target}`} plain onPress={() => toggle($, bk)}>{editing ? w.collapse : r.brief ? w.editBrief : w.addBrief}</Button>
            {onRemove && <Button key={`rmc-${target}`} plain onPress={onRemove}>{w.remove}</Button>}
          </Box>
        )}
        {!takesBrief && onRemove && <Button key={`rmc-${target}`} plain onPress={onRemove}>{w.remove}</Button>}
        {takesBrief && editing && 'Input' in ui && (
          <ui.Input key={`bf-${target}`} value={r.brief ?? ''} submitLabel={w.save} autoFocus
            placeholder={r.handle === 'approve' ? w.approveBrief : w.dispatchBrief}
            onSubmit={(val: string) => { void setBrief($, target, val.trim()); void toggle($, bk) }} />
        )}
      </Box>
    )
  }

  // 每一块规矩框起来，一眼分得清层级。
  const section = (key: string, text: string, sub: string | undefined, ...body: RenderChildren[]) => (
    <Box key={key} flexDirection="column" borderStyle="round" borderColor="inactive" paddingX="md" paddingY="sm" gap="xs" marginTop="sm">
      <Box flexDirection="column">
        <Text weight="semibold">{text}</Text>
        {sub && <Text size="caption" dimColor wrap="wrap">{sub}</Text>}
      </Box>
      {body}
    </Box>
  )

  // 一块里的小标题：粗一点的名字，下面一行灰字说明。
  const sub = (key: string, text: string, help: string) => (
    <Box key={key} flexDirection="column" marginTop="sm">
      <Text size="footnote" weight="semibold">{text}</Text>
      <Text size="caption" dimColor wrap="wrap">{help}</Text>
    </Box>
  )
  // 名单里的一个人 / 对话：认得名字就写名字，编号放后面。
  const who = (x: string) => (s.people?.[x] ? `${s.people[x]}${t().paren(x)}` : x)
  const list = (key: string, items: string[], show: (x: string) => string, remove: (x: string) => void, label: string) => [
    items.length === 0 && <Text key={`${key}-none`} size="footnote" dimColor>{w.none}</Text>,
    ...items.map((x, i) => (
      <Box key={`${key}${i}`} flexDirection="row" justifyContent="space-between" alignItems="flex-start" gap="sm" paddingY="xs">
        <Box flexGrow={1} flexShrink={1}><Text wrap="wrap">{show(x)}</Text></Box>
        <Button key={`r${key}${i}`} plain onPress={() => remove(x)}>{label}</Button>
      </Box>
    )),
  ]
  const input = (key: string, placeholder: string, onAdd: (v: string) => void) => 'Input' in ui && (
    <Box key={`${key}-add`} width="100%"><ui.Input key={key} placeholder={placeholder} submitLabel={w.add} onSubmit={(v: string) => {
      if (v.trim()) onAdd(v.trim())
    }} /></Box>
  )

  return (
    <Box flexDirection="column" marginTop="sm">
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Text size="caption" dimColor>{w.live}</Text>
        <Button key="policy-help" plain onPress={() => toggle($, 'policy-help')}>{helpOpen ? w.hideHelp : w.showHelp}</Button>
      </Box>
      {helpOpen && (
        <Box flexDirection="column" gap="xs" marginTop="xs" paddingLeft="sm">
          {w.help.map((x, i) => <Text key={`ph${i}`} size="footnote" dimColor wrap="wrap">{x}</Text>)}
        </Box>
      )}

      {section('sec-scenarios', w.scenariosTitle, w.scenariosSub,
        Object.entries(p.scenarios).map(([k, v]) => ruleRow(k, scenarioName(k), v)))}

      {section('sec-yours', w.yoursTitle, w.yoursSub,
        sub('yours-custom', w.customTitle, w.customSub),
        p.custom.length === 0 && <Text key="cu-none" size="footnote" dimColor>{w.none}</Text>,
        p.custom.map(c => ruleRow(`custom:${c.id}`, c.when, c, () => void removeCustom($, c.id))),
        input('add-custom', w.customPlaceholder, v => void addCustom($, v)),
        sub('yours-notes', w.notesTitle, w.notesSub),
        ...list('nt', p.notes, x => x, x => void removeRule($, x), w.remove),
        input('add-rule', w.notesPlaceholder, v => void addRule($, v)))}

      {section('sec-people', w.peopleTitle, undefined,
        sub('people-trusted', w.trustedTitle, w.trustedSub),
        ...list('tr', p.trusted ?? [], who, x => void trust($, x, false), w.removeFrom),
        input('add-trusted', w.trustedPlaceholder, v => void trust($, v, true)),
        sub('people-always', w.alwaysTitle, w.alwaysSub),
        ...list('aa', p.askAlways ?? [], who, x => void askAlways($, x, false), w.removeFrom),
        input('add-always', w.alwaysPlaceholder, v => void askAlways($, v, true)))}

      {section('sec-reply', w.replyTitle, undefined,
        sub('reply-style', w.styleTitle, w.styleSub),
        ...list('st', p.style ?? [], x => x, x => void removeStyle($, x), w.remove),
        input('add-style', w.stylePlaceholder, v => void addStyle($, v)),
        sub('reply-quick', w.quickTitle, w.quickSub),
        ...list('qk', p.quick ?? [], x => x, x => void removeQuick($, x), w.remove),
        input('add-quick', w.quickPlaceholder, v => void addQuick($, v)),
        sub('reply-placement', w.placementTitle, w.placementSub),
        (Object.entries(L().audience) as [keyof typeof DEFAULT_PLACEMENT, string][]).map(([k, label]) => (
          <Box key={`pl-${k}`} flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm" paddingY="xs">
            <Text>{label}</Text>
            {select(ui, `pl-${k}`, (p.placement ?? DEFAULT_PLACEMENT)[k], [{ value: 'inline', label: w.inline }, { value: 'thread', label: w.thread }], v => void setPlacement($, k, v as 'inline' | 'thread'))}
          </Box>
        )),
        sub('reply-signature', w.signatureTitle, w.signatureSub),
        'Input' in ui
          ? <ui.Input key="signature" value={p.signature ?? DEFAULT_SIGNATURE} submitLabel={w.save} onSubmit={(v: string) => void setSignature($, v.trim())} />
          : <Text key="sig">{p.signature ?? DEFAULT_SIGNATURE}</Text>)}

      {section('sec-how', w.howTitle, w.howSub, howItDoes($, ui, s))}
    </Box>
  )
}
