// 面板顶上：不正常的才说（引擎、主会话、来源、数据文件），三个页签加设置，刚做的能撤回，攒着的批注。
// 钥匙被动过、主会话没在听这些要你动手的，在「要你」页里（inbox.ts）。
import type { EngineInterface as Engine } from 'claude-code'

import { DATA_HEALTH } from '../../engine/src/shared/rules'
import type { Snapshot } from '../../types'
import { clearBasket, sendBasket, setTab, unannotate, undo } from '../actions'
import { inboxOf } from '../inbox'
import { sourceName, t } from '../i18n'
import { short, type Els } from '../ui'

export function header($: Engine, ui: Els, s: Snapshot, said: string, current: string, basket: { key: string; label: string; text: string }[] = [], setupMissing = 0) {
  const { Box, Text, Button } = ui
  const w = t().header
  const box = inboxOf(s)
  // 你刚在面板上点的「不做了」「跳过积下的」：两分钟内顶上留一个撤回（更早的在进度页「最近」里撤）。
  const fresh = s.undo.find(x => !x.undone && x.kind !== 'mark' && Date.now() - Date.parse(x.at) < 120_000)
  // 提示是「时间|文字」：只显示最近 8 秒的。
  const bar = said.indexOf('|')
  const noteText = bar > 0 && Date.now() - Number(said.slice(0, bar)) < 8000 ? said.slice(bar + 1) : ''
  const tabs: { key: 'now' | 'things' | 'policy'; label: string; n: number }[] = [
    { key: 'now', label: w.tabs.now, n: box.count },
    { key: 'things', label: w.tabs.things, n: 0 },
    { key: 'policy', label: w.tabs.policy, n: 0 },
  ]
  // 只报不正常的：引擎没在跑、主会话没在听、来源连不上、数据文件坏了。都好就一个绿点。
  const broken = Object.entries(s.health).filter(([k, h]) => h.fails >= 2 && k !== DATA_HEALTH && s.sources[k] === true).map(([k]) => k)
  const corrupt = s.health[DATA_HEALTH]
  const trouble = [
    s.engineAt === null ? w.engineDown : '',
    !s.hub.listening ? w.hubDown : '',
    broken.length > 0 ? w.unreachable(broken.map(sourceName)) : '',
    corrupt && !corrupt.ok ? w.corrupt : '',
  ].filter(Boolean).join(' · ')
  const at = (k: string) => current === k || (k === 'now' && current === 'outbox') || (k === 'policy' && current === 'eval')
  return (
    <Box flexDirection="column" gap="sm">
      <Box flexDirection="row" alignItems="center" gap="lg" flexWrap="wrap">
        {trouble === '' ? <Text color="success">●</Text> : <Text size="caption" color="error">● {trouble}</Text>}
        {tabs.map(x => at(x.key)
          // 当前页不是按钮：按钮里的字 App 一律画成同一个颜色，分不出选中。
          ? <Text key={`tab-${x.key}`} weight="semibold" color="claude" underline>{x.label}{x.n > 0 ? ` ${x.n}` : ''}</Text>
          : <Button key={`tab-${x.key}`} plain onPress={() => setTab($, x.key)}>{x.n > 0 ? `${x.label} ${x.n}` : x.label}</Button>)}
        {current === 'setup'
          ? <Text key="tab-setup" weight="semibold" color="claude" underline>{w.tabs.setup}{setupMissing > 0 ? ` ${setupMissing}` : ''}</Text>
          : <Button key="tab-setup" plain onPress={() => setTab($, 'setup')}>{setupMissing > 0 ? `${w.tabs.setup} ${setupMissing}` : w.tabs.setup}</Button>}
      </Box>
      {noteText !== '' && <Text size="footnote" color="suggestion">{noteText}</Text>}
      {fresh && (
        <Box flexDirection="row" gap="sm" alignItems="center">
          <Box flexShrink={1}><Text size="footnote" wrap="truncate-end"><Text dimColor>{w.justDid}</Text>{fresh.label}</Text></Box>
          <Button key="undo-fresh" onPress={() => undo($, fresh.id)}>{w.undo}</Button>
        </Box>
      )}
      {basket.length > 0 && (
        <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX="md" paddingY="sm" gap="xs">
          <Text weight="semibold">{w.basket(basket.length)}</Text>
          {basket.map((x, i) => (
            <Box key={`bk-${i}`} flexDirection="row" gap="sm" alignItems="flex-start">
              <Box flexGrow={1} flexShrink={1}>
                <Text size="footnote" wrap="wrap">{x.key === 'note' ? '' : <Text dimColor>{short(x.label.replace(/[#＃]\d+\s*/g, ''), 30)}　</Text>}{x.text}</Text>
              </Box>
              <Button key={`unb-${i}`} plain onPress={() => unannotate($, i)}>✕</Button>
            </Box>
          ))}
          <Box flexDirection="row" gap="sm" marginTop="xs">
            <Button key="send-basket" variant="primary" onPress={() => sendBasket($)}>{w.sendBasket}</Button>
            <Button key="clear-basket" onPress={() => clearBasket($)}>{w.clearBasket}</Button>
          </Box>
        </Box>
      )}
    </Box>
  )
}
