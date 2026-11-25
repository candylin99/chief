# 自己维护的 chief fork：怎么改面板

这是 `jinjin99/chief` 的 fork（candylin99/chief），本机 Claude App 的插件源已指向它。
`main` 是本机装的版本；`upstream-main` 分支存着换源那天上游的代码。

## 面板代码在哪

都在 `plugin/hooks/`（0.4.0 起一个页签一个文件）：

| 文件 | 管什么 |
|---|---|
| `tabs/things.tsx` | 「进度」页：每件事一行，状态标签、最近进展（**改事项卡片的信息密度、标签主要改这里**） |
| `tabs/now.tsx` + `inbox.ts` | 「要你」页：要你动手的事，一件事一张卡；`inbox.ts` 是排序和归组算法 |
| `tabs/outbox.tsx` | 等你确认的回复卡（画在「要你」页里） |
| `tabs/policy.tsx` / `tabs/eval.tsx` | 「规矩」页、它做得怎么样 |
| `tabs/timeline.tsx` | 进度页底部「最近 7 天」时间线 |
| `tabs/header.tsx` | 面板顶部：状态提示、页签、批注篮 |
| `ui.tsx` | 页签共用的小组件、来源名字表、时间/截止日说法 |
| `i18n.ts` | 面板上所有给人看的字（中英两本字典，加新文案要两边都加，否则 tsc 报错） |
| `data.ts` | 面板读的数据：从 `~/chief/data` 的文件算出一份快照（只读文件，不调外部接口） |
| `actions.ts` | 面板上的按钮点下去做什么 |
| `register.tsx` | 把面板注册进 Claude App（`/chief` 命令、pane 定义） |
| `setup.tsx` | 设置页；**也负责插件版本比引擎新时自动更新引擎**（见下） |
| `types/index.d.ts` | 面板读的数据结构（事项、回复、问题……） |

其他目录：`plugin/engine/` 是引擎代码（launchd 服务 `dev.chief.engine` 跑在 `~/chief/data/app`，升级插件时才会更新它）；`plugin/skills/` 是主会话 skill；`plugin/workspace/` 是工作会话模板。
**`~/chief` 下全是运行数据（rules.json、notes/、data/），不在这个仓库里，改面板不要动它。**

## 改完怎么让本机生效

本机实际运行的是安装缓存 `~/.claude/plugins/cache/chief/chief/<版本>/`，不是这个 clone，所以改完要走一次更新：

1. 在这里改代码，**把 `plugin/.claude-plugin/plugin.json` 的 `version` 往上加一号**（比如 `0.2.1` → `0.2.2`；版本不变插件管理器会认为没更新）。
2. 提交并推到 fork：`git add -A && git commit -m "..." && git push`。
3. 刷新 marketplace 并更新插件：

```bash
claude plugin marketplace update chief
```

```bash
claude plugin update chief@chief
```

4. 重启 Claude App（或重开会话）让新面板代码加载；`/chief` 打开面板验证。
5. 到消息中心说一声「chief：重读规则」，让主会话读到新版 hub 说明。

**注意：只要版本号升了，面板加载时就会自动更新引擎**（`setup.tsx` 比对 `~/chief/data/app/VERSION`，插件更新就在后台跑 `setup.sh`：在 `app.new` 装好试过再换上，旧的留成 `app.prev`，重新注册 launchd 即重启引擎；新引擎第一次跑会给 `~/chief/data` 的数据文件补版本号）。只改面板不改引擎时也会触发这一遍，正常，几十秒到一两分钟。要退回旧引擎：把 `app.prev` 改名回 `app` 再重新装进 launchd。

快速改小样式也可以直接编辑缓存目录里的文件立刻看效果，但那只是试验——**正式改动一定落回这个仓库**，否则下次更新会被覆盖。

## 跑测试

```bash
cd plugin && npm test
```

（面板测试在 `plugin/tests/pane.test.tsx`，引擎测试在 `plugin/engine/test/`。）

## 以后想合上游新版本

```bash
git fetch upstream
git merge upstream/main
```

（clone 里已配好 `upstream` = jinjin99/chief。）
**合完一定检查 `.claude-plugin/marketplace.json`**：上游的清单把插件钉到 `jinjin99/chief` 的发版 tag（`git-subdir` + `ref`/`sha`），fork 这里改成了 `"source": "./plugin"`（装的就是 fork main 上的代码）。合并冲突或被覆盖时保留 fork 的写法，否则本机会悄悄装回上游的版本。上游的 `scripts/release.sh` 会把清单改回 tag 写法，fork 里不要用它发版。
合完先看 `plugin/engine/` 和 `plugin/engine/src/migrate.ts` 的改动：版本号一升，本机装上就会自动换引擎、迁移数据文件，别手动动 `~/chief/data/app`。

## fork 自己加的功能

### 0.5.0–0.5.2：进度页的状态表（2026-11-25）

- **状态表**（`hooks/tabs/things.tsx`）：进度页最上面一行是每个阶段几件（加卡住、暂停几件），下面每件事一行：
  - 第一行：阶段（带颜色的边框块）、标记（会话在等你回答、过期 / 快到期、卡住、暂停、等你定）、标题、多久以前有动静和截止。
  - 第二行标签，都能点（`hooks/tags.tsx`）：在哪讨论过（一个渠道一个：💬 Slack、🎫 Jira、🔀 GitHub、📄 Notion，一处写名字、几处写「Slack · 2 处」，点开那个渠道最近一条）、关联的需求（Jira 子任务换成父需求，标题里写的单号也算）、PR（review 和 CI）、🧵 会话。
  - 点标题展开：每处讨论各一行（几条、多久以前、最早从哪来，能点开），下面是最近说的；再是下一步、现在、结果和操作。
  - 按阶段从前到后排，同一阶段里要你留意的在前。「要你」页的事情卡也有阶段和这行标签。
- **画法**（0.5.2，样例里挑的 B）：阶段、标记、标签都是一行彩色文字，用「·」隔开，没有底色和边框；需求、PR、讨论渠道是链接（只链 Slack / Atlassian / GitHub / Notion 的 https 地址）。不用按钮和带边框的框：App 在桌面上把按钮画成带内边距的原生按钮、按钮里的字一律一个颜色，边框框也很高。例外是「🧵 会话」：App 只把 https 画成能点的链接，会话用不带框的按钮跳过去。
- **阶段**（`engine/src/shared/stage.ts`）：计划中 → 方案中 → 开发中 → 用例评审中 → 测试中 → 待发布 → 已上线；「暂停」「卡住」是标记。依次取：
  1. 需求的 Jira 状态：OPEN→计划中、Under development→开发中、Test In Progress / Acceptance Check→测试中、Ready To Deploy→待发布、Released / Test In Production / Closed→已上线、ON HOLD→暂停。
  2. 会话汇报的（`chief thing update T` 标准输入 JSON 的 `stage`）：只在 Jira 还是 OPEN 时用，补上方案中、用例评审中。
  3. 没有 Jira：汇报的，再没有看 PR（有开着的算开发中，全合了算待发布）。
  - 改词表、映射：改 `stage.ts` 的 `STAGES`、`STAGE_LABELS`、`ALIASES`、`JIRA`，测试在 `engine/test/links.spec.ts`。
- **数据**（`engine/src/links.ts`）：引擎起来查一次、之后每 10 分钟，用 acli 查 Jira 单（和父需求）、gh 查 PR（90 秒超时），把每件事的消息按渠道和对话合起来，写进 `~/chief/data/links.json`。查不成接着用上一轮的；连着失败超过半小时，进度页顶上才有一行黄字。
- hub 的派活模板（`skills/hub/handoff.md`）和「chief 进展」的处理（`SKILL.md`）带「阶段」。

### 0.6.0：要你定的问题能先问清楚（2026-11-25）

- 问题卡在「建议」下面多两行：**依据**（这个建议是看了什么、谁说了什么得出来的）和**不照办**（选别的会怎样）。工作会话报「chief 要你定」时多写「依据：」「不照办：」两行，消息中心登记时放进 `chief ask add` 的 `basis`、`ifNot`。
- 「照办」旁边多一个**先问清楚**：点开可以写想知道什么，不写就问「背景、为什么这么建议、不照办会怎样」。面板先 `chief ask explain Q --ask` 记下在问（卡上显示「在问清楚：…」），再发「chief：问题 #Q 先问清楚：…」给消息中心；消息中心转给提出问题的会话，会话回「chief 解释 #Q」，消息中心 `chief ask explain Q` 写回，卡上整段显示「解释」。问题一直开着，不算你的决定。
- 改法：引擎 `engine/src/commands/things.ts` 的 `ask`；面板 `hooks/tabs/now.tsx` 的 askCard、`hooks/actions.ts` 的 `explainAsk`；说明 `skills/hub/SKILL.md`、`panel-commands.md`、`handoff.md`。

### 0.8.0–0.8.1：通知卡和「已读 👀」（2026-11-25）

- 主会话 `chief mark … noted` 的 Slack 私信、@我、你在的 thread 后续（@here / @channel 群发除外），引擎记成通知（`notices.json`，`engine/src/notices.ts`）；改判成别的，没读的卡撤掉。
- 「要你」页下面单独一个「通知」区（不和要你定混在一起），**一段对话一张卡**：最新那条（谁 · 在哪 · 事情 · 多久以前、一句话、原消息链接），同一段里还有几条没看写在下面。按真实数据估过：一条一张的话最近每天 40～66 张，按对话合成后每天 7～11 张。
- 「已读 👀」：面板直接跑 `chief notice read <事件号>`（不经过主会话），引擎下一秒以你的身份在最新那条上加 :eyes:（`SlackPlugin.react`），同一段里更早没看的跟着算看过（covered，不一条条加）。重复点、Slack 说 already_reacted 都只算一次；加不上（消息删了、没权限、Slack 没连上）卡上写原因，能「再试一次」。
- `chief notice backfill [--hours 24]`：装上以前就只记下的，补出卡。
- **已经有回应的不出卡**（0.8.1）：消息之后 chief 在同一段对话里回过 / approve 过、approve 了消息里链着的 PR，或链着的 PR 你已 approve / 合了 / 关了（这些 PR 每轮 links 一起查），或你自己在那段对话里说过话 → 自动算看过收起（`handled` 记为什么），不加 :eyes:。引擎每分钟和发出回复之后跑（`settleNotices`）。
- 只做 Slack。

### 0.7.0：过时清扫（2026-11-25）

引擎每 10 分钟查完单子和 PR（links.ts）顺带清扫一遍待办（`engine/src/sweep.ts`，`Engine.sweep`），只改 chief 自己的待办、发提醒，不对外发任何东西：
1. **approve 卡**（等你点的、没发出去的）：PR 已合并 / 已关闭 / 你自己 approve 过（`gh pr view` 带 reviews，你的登录名用 `gh api user` 问一次）→ 收起（status 改 dropped，记 `stale: {why, at, was}`）。「要你」页那件事的卡上留一行灰字和「不对，恢复」（`chief reply unstale R`，放回原状态并记 `staleIgnored`，以后不再收）。等你点的 approve 卡要 approve 的 PR 就算没挂在事情上也会查。
2. **待发出的 Slack 回复**：引擎记下你本人（在别的端）每段对话最近一次说话的时间（state.json 的 `spoke`，对话的键和收到的消息一样）；卡片生成之后你说过话 → 卡上标 `selfReplied`「你可能已经亲自回过」，不收不发。规矩允许直接发、正在排队的，发之前也查，查到就放回待确认、弹通知（你点的发送照发）。只看 Slack。
3. **要你定的问题**：问题那件事挂的 PR 合了 / 关了、Jira 做完了，或问题和建议里提到的 PR / 单号办完了 → 交给主会话一条 `ask.stale` 事件（每个问题、每个键只一次），主会话判断撤不撤（SKILL.md）。
4. **可以收尾**：挂的 PR 都合了（至少合了一个、没有开着的）、需求的 Jira 都做完了 → 事情的标记里多一个绿色「可以收尾」（面板算，`hooks/tags.tsx` 的 `canWrap`），只提示，不替你标办完。

### 0.6.1–0.6.2：不再重复提交（2026-11-25）

- **面板点两下发两次**：面板上的按钮是往消息中心发一句「chief：…」，消息中心在忙时点了没动静，人会再点，以前每点一下都发一次（实际出现过「问进展」18 秒内两次、「重读规则」36 秒内两次）。现在同一句话两分钟内只发一次，第二下只提示「刚交给主会话了」（`hooks/actions.ts` 的 `tell` / `seenRecently`）。
- **交出去的按钮置灰**（0.6.2）：面板往主会话交话全部走 `submitOnce`（问进展、问一遍进展、重读规则、批注、开消息中心、改过再发的提醒都算）；交过的那句两分钟内对应按钮画成灰字「… · 已交给消息中心」，点不了；「先问清楚」在等解释时画成「在问清楚…」。批注改成先清空再交，连点不会交两批。状态是异步读的，所以 `register.tsx` 每次画面板前读一次 `sent` 交给 `setSentNow`，按钮同步查。
- 消息中心记录里看到同一句「chief：…」出现很多次，大部分是 `last-prompt` 记录（App 每轮记一下最后一句话），不是真的又发了一次；真重复的只有连点那几次。
- **同一份回复稿交两次**：`chief reply add` 对同一条消息、一字不差（空白不算）的稿子只收一次；已经在待发出、发出去了、用户不发了、用户让重写的，原样再交都会被拒，报错说清怎么办（`engine/src/commands/reply.ts` 的 `sameText` / `duplicateWhy`）。消息中心的 `reply.md` 写了照报错办。

## 本机换源记录（2026-11-24）

- `~/.claude/settings.json` → `extraKnownMarketplaces.chief.source.repo` = `candylin99/chief`（原 `jinjin99/chief`）。
- `claude plugin marketplace update chief` 已重新 clone 到 `~/.claude/plugins/marketplaces/chief`，HEAD = fork main（0.2.1）。
- 已装插件缓存、`~/chief` 用户数据、引擎服务都没动。
- 同日升级到 0.4.0（合并上游 `0fd9971`）：升级前把 `~/chief` 备份到 `~/chief-backup-20261124`（不含 node_modules）；面板加载后引擎自动换成 0.4.0，数据文件迁移到 `version: 1`，事项、回复数量不变。中途清单还钉着上游 tag，先装了一次上游 0.3.0（引擎也被自动换成过 0.3.0），所以 `app.prev` 里是 0.3.0 的引擎，不是 0.2.1。
- 上游曾重写历史：本机装的 commit `71e0c0e` 在新历史里对应 `023868a`，唯一差异是示例文案（上游把示例里的真实名字/单号洗掉了，如 `OPS-35121`→`PERF-35121`、`jk.yuan`→`bob.lee`），代码功能一致。
