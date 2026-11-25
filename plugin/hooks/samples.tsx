// 临时：进度页最上面的样式样例。同一件事用几种紧凑的写法各画一行，用户在 App 里截图挑一种，挑好就删掉这个文件。
// 写法都不用按钮（App 在桌面上把按钮画成带内边距的原生按钮，标签会很高）：用文字自己的底色 / 颜色，点开靠 Link。
import type { Snapshot, ThingRow } from '../types'
import { stageLabel, thingStage } from './tags'
import type { Els } from './ui'

// 半透明的底色：浅色、深色主题下都看得清。
const TINT = {
  blue: 'rgba(55,138,221,0.16)', amber: 'rgba(239,159,39,0.20)', green: 'rgba(99,153,34,0.18)',
  red: 'rgba(226,75,74,0.16)', purple: 'rgba(127,119,221,0.18)', gray: 'rgba(136,135,128,0.16)',
} as const

type Chip = { text: string; tone: 'suggestion' | 'warning' | 'success' | 'error' | 'merged' | 'inactive'; tint: keyof typeof TINT; url: string }

function chipsOf(): Chip[] {
  return [
    { text: '💬 #proj-warranty', tone: 'inactive', tint: 'gray', url: 'https://aftership.slack.com/' },
    { text: '🔀 GitHub · 9 处', tone: 'inactive', tint: 'gray', url: 'https://github.com/' },
    { text: '🎫 RTC-34362 开发中', tone: 'suggestion', tint: 'blue', url: 'https://aftership.atlassian.net/browse/RTC-34362' },
    { text: '🔀 #571 待 review', tone: 'warning', tint: 'amber', url: 'https://github.com/' },
    { text: '🔀 #448 已合并', tone: 'success', tint: 'green', url: 'https://github.com/' },
  ]
}

// 没有 emoji 的版本：前面写渠道名的缩写。
function plainChipsOf(): Chip[] {
  return [
    { text: 'Slack #proj-warranty', tone: 'inactive', tint: 'gray', url: 'https://aftership.slack.com/' },
    { text: 'GitHub 9 处', tone: 'inactive', tint: 'gray', url: 'https://github.com/' },
    { text: 'Jira RTC-34362 开发中', tone: 'suggestion', tint: 'blue', url: 'https://aftership.atlassian.net/browse/RTC-34362' },
    { text: 'PR #571 待 review', tone: 'warning', tint: 'amber', url: 'https://github.com/' },
    { text: 'PR #448 已合并', tone: 'success', tint: 'green', url: 'https://github.com/' },
  ]
}

export function stylesSample(ui: Els, s: Snapshot) {
  if (!('Link' in ui)) return null
  const { Box, Text, Link } = ui
  const th: ThingRow | undefined = s.things.find(x => x.status === 'doing')
  const st = th ? thingStage(s, th).stage : null
  const stage = st ? stageLabel(st) : '开发中'
  const title = th ? th.title.slice(0, 30) : 'RTC-35159 Warranty 自行寄回'
  const chips = chipsOf()

  const label = (n: string, what: string) => <Text size="caption" weight="semibold" dimColor>{n}　{what}</Text>

  return (
    <Box flexDirection="column" gap="md" borderStyle="round" borderColor="claude" paddingX="md" paddingY="sm" marginBottom="md">
      <Text weight="semibold" color="claude">样式样例（临时）：截图发给 Claude，说选哪个</Text>

      {label('A', '文字底色块 + 链接（像设计稿）')}
      <Box flexDirection="column" gap="xs">
        <Text>
          <Text size="caption" weight="semibold" color="suggestion" backgroundColor={TINT.blue}> {stage} </Text>{' '}
          <Text size="caption" weight="semibold" color="error" backgroundColor={TINT.red}> 卡住 </Text>{' '}
          <Text weight="semibold">{title}</Text>
        </Text>
        <Text size="caption">
          {chips.map((c, i) => (
            <Text key={`a${i}`} color={c.tone === 'inactive' ? undefined : c.tone} backgroundColor={TINT[c.tint]}>{' '}<Link href={c.url}>{c.text}</Link>{' '}{i < chips.length - 1 ? '' : ''}</Text>
          ))}
        </Text>
      </Box>

      {label('B', '彩色文字链接，用 · 隔开，没有底色')}
      <Box flexDirection="column" gap="xs">
        <Text><Text size="caption" weight="semibold" color="suggestion">{stage}</Text><Text dimColor> · </Text><Text size="caption" weight="semibold" color="error">卡住</Text>{'　'}<Text weight="semibold">{title}</Text></Text>
        <Text size="caption">
          {chips.map((c, i) => (
            <Text key={`b${i}`} color={c.tone === 'inactive' ? undefined : c.tone}><Link href={c.url}>{c.text}</Link>{i < chips.length - 1 ? <Text dimColor>{'  ·  '}</Text> : ''}</Text>
          ))}
        </Text>
      </Box>

      {label('C', '底色块，文字不放进链接，后面跟一个小 ↗ 链接')}
      <Box flexDirection="column" gap="xs">
        <Text>
          <Text size="caption" weight="semibold" color="suggestion" backgroundColor={TINT.blue}> {stage} </Text>{' '}
          <Text weight="semibold">{title}</Text>
        </Text>
        <Text size="caption">
          {chips.map((c, i) => (
            <Text key={`c${i}`}><Text color={c.tone === 'inactive' ? undefined : c.tone} backgroundColor={TINT[c.tint]}> {c.text} </Text><Link href={c.url}>↗</Link>{'  '}</Text>
          ))}
        </Text>
      </Box>

      {label('D', '同 A，但不用 emoji，前面写 Slack / Jira / PR')}
      <Box flexDirection="column" gap="xs">
        <Text size="caption">
          {plainChipsOf().map((c, i) => (
            <Text key={`d${i}`} color={c.tone === 'inactive' ? undefined : c.tone} backgroundColor={TINT[c.tint]}>{' '}<Link href={c.url}>{c.text}</Link>{' '}</Text>
          ))}
        </Text>
      </Box>

      {label('E', '阶段用细边框小块（和现在汇总那行同一种画法，对比高度）')}
      <Box flexDirection="row" gap="xs" alignItems="center">
        <Box borderStyle="round" borderColor="suggestion" paddingX={0} paddingY={0}><Text size="caption" color="suggestion"> {stage} </Text></Box>
        <Text weight="semibold">{title}</Text>
      </Box>
    </Box>
  )
}
