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

### 0.5.0：进度页的状态表（2026-11-25）

- **状态表**（`hooks/tabs/things.tsx`）：进度页最上面一行是每个阶段几件（加卡住、暂停几件），下面每件事一行：
  - 第一行：阶段（带颜色的边框块）、标记（会话在等你回答、过期 / 快到期、卡住、暂停、等你定）、标题、多久以前有动静和截止。
  - 第二行标签，都能点（`hooks/tags.tsx`）：在哪讨论过（一个渠道一个：💬 Slack、🎫 Jira、🔀 GitHub、📄 Notion，一处写名字、几处写「Slack · 2 处」，点开那个渠道最近一条）、关联的需求（Jira 子任务换成父需求，标题里写的单号也算）、PR（review 和 CI）、🧵 会话。
  - 点标题展开：每处讨论各一行（几条、多久以前、最早从哪来，能点开），下面是最近说的；再是下一步、现在、结果和操作。
  - 按阶段从前到后排，同一阶段里要你留意的在前。「要你」页的事情卡也有阶段和这行标签。
- **颜色**：App 把按钮里的字一律画成同一个颜色，所以颜色只用边框和按钮外面的字（阶段、标记是不能点的边框块，标签是边框里放按钮）。
- **阶段**（`engine/src/shared/stage.ts`）：计划中 → 方案中 → 开发中 → 用例评审中 → 测试中 → 待发布 → 已上线；「暂停」「卡住」是标记。依次取：
  1. 需求的 Jira 状态：OPEN→计划中、Under development→开发中、Test In Progress / Acceptance Check→测试中、Ready To Deploy→待发布、Released / Test In Production / Closed→已上线、ON HOLD→暂停。
  2. 会话汇报的（`chief thing update T` 标准输入 JSON 的 `stage`）：只在 Jira 还是 OPEN 时用，补上方案中、用例评审中。
  3. 没有 Jira：汇报的，再没有看 PR（有开着的算开发中，全合了算待发布）。
  - 改词表、映射：改 `stage.ts` 的 `STAGES`、`STAGE_LABELS`、`ALIASES`、`JIRA`，测试在 `engine/test/links.spec.ts`。
- **数据**（`engine/src/links.ts`）：引擎起来查一次、之后每 10 分钟，用 acli 查 Jira 单（和父需求）、gh 查 PR（90 秒超时），把每件事的消息按渠道和对话合起来，写进 `~/chief/data/links.json`。查不成接着用上一轮的；连着失败超过半小时，进度页顶上才有一行黄字。
- hub 的派活模板（`skills/hub/handoff.md`）和「chief 进展」的处理（`SKILL.md`）带「阶段」。

## 本机换源记录（2026-11-24）

- `~/.claude/settings.json` → `extraKnownMarketplaces.chief.source.repo` = `candylin99/chief`（原 `jinjin99/chief`）。
- `claude plugin marketplace update chief` 已重新 clone 到 `~/.claude/plugins/marketplaces/chief`，HEAD = fork main（0.2.1）。
- 已装插件缓存、`~/chief` 用户数据、引擎服务都没动。
- 同日升级到 0.4.0（合并上游 `0fd9971`）：升级前把 `~/chief` 备份到 `~/chief-backup-20261124`（不含 node_modules）；面板加载后引擎自动换成 0.4.0，数据文件迁移到 `version: 1`，事项、回复数量不变。中途清单还钉着上游 tag，先装了一次上游 0.3.0（引擎也被自动换成过 0.3.0），所以 `app.prev` 里是 0.3.0 的引擎，不是 0.2.1。
- 上游曾重写历史：本机装的 commit `71e0c0e` 在新历史里对应 `023868a`，唯一差异是示例文案（上游把示例里的真实名字/单号洗掉了，如 `OPS-35121`→`PERF-35121`、`jk.yuan`→`bob.lee`），代码功能一致。
