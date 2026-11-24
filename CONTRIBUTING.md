# 参与开发

先看 [ARCHITECTURE.md](ARCHITECTURE.md) 了解各部分怎么连起来。

## 开发环境

要求：macOS、Claude App、Node 24 以上。

```bash
cd plugin/engine && npm install
```

本地开发用 `plugin/.claude-plugin/marketplace.json` 里的开发版 marketplace（名字是 `chief-dev`），插件直接从这个目录读。先卸掉正式版，两个别同时装：

```bash
claude plugin uninstall chief@chief
claude plugin marketplace add ./plugin
claude plugin install chief@chief-dev --scope user
```

- 改了面板（`plugin/hooks/`）或 skill（`plugin/skills/hub/`）：在会话里 `/reload-plugins`。主会话要用上新 skill，在设置页点「重读规则」。
- 改了引擎（`plugin/engine/src/`）：`bash plugin/setup.sh` 把引擎重新部署到 `~/chief/data/app` 并重启。这会换掉你自己正在用的引擎。只想试命令行的话，设 `CHIEF_HOME` 指到一个空目录再跑 `npx tsx src/cli.ts …`，数据就不落进 `~/chief/data`。

## 测试

提交前这几样都要过（CI 也跑同样的）：

```bash
cd plugin/engine
npx tsc --noEmit         # 类型检查
npx vitest run           # 引擎和命令行（test/*.spec.ts）
cd ../..
claude plugin validate plugin
claude plugin test plugin   # 面板（plugin/tests）
```

改了引擎行为就补测试；改了面板的文字或按钮，看看 `plugin/tests/pane.test.tsx` 有没有要跟着改的。

## 加一个来源

要改的就这几处（细节见 [ARCHITECTURE.md](ARCHITECTURE.md)「加一个来源」）：

1. `plugin/engine/src/shared/sources.ts`：`SOURCE_META` 加一项（名字、场景和默认做法、设置页怎么连）。
2. `plugin/engine/src/sources/<名字>.ts`：实现 `Source`，导出一份 `SourceDescriptor`。
3. `plugin/engine/src/sources/registry.ts`：放进 `SOURCES`。
4. hub skill 里认场景的那句补上新场景。

`test/registry.spec.ts` 会检查名单和注册表对得上；再给新来源的 `poll` 补个测试（照 `test/github.spec.ts`、`test/jira.spec.ts`）。

## 面板和引擎共用的代码

`plugin/engine/src/shared/` 里的文件面板也直接 import（插件运行时里没有 Node）：只写纯 TypeScript，不 import `node:` 的东西，也不 import `shared/` 以外的文件。面板的类型合同 `plugin/types/index.d.ts` 不能 import，改了 `shared/types.ts` 里的数据类型，照着改那边，`npx tsc --noEmit` 会检查两边对得上（`test/contract.spec.ts`）。

## 风格

- 注释、skill 都用中文，大白话，短。说清「为什么」，不写空话。界面文字和引擎的通知写进字典（面板 `plugin/hooks/i18n.ts`，引擎 `src/messages.ts`，两边共用的名字 `src/shared/i18n.ts`），zh 和 en 都要写：en 少一项 `npx tsc --noEmit` 会报错。交给主会话的话（「chief：…」）不进字典，hub 认的是中文原话。
- 代码跟着已有的写法走：小函数、少抽象、不加用不上的配置。
- skill（`SKILL.md`）每次「重读规则」都会整份读进上下文，只放每次都用得上的；不常用的流程放进同目录的 md，在 SKILL.md 里说清什么时候读。引擎能检查的规矩交给引擎，skill 里一句话带过。
- 提交信息用中文，一句话说清改了什么、为什么。

## 不要放进仓库的东西

这是公开仓库。例子、测试数据、截图、提交信息里都不要出现：真实的人名或账号、公司名和域名、内部仓库名、真实的工单号、Slack 工作区名、令牌和 Cookie。用占位的：`bob.lee`、`PROJ-123`、`acme/shop`、`acme.atlassian.net`。

## 发版

```bash
# 先把 plugin/.claude-plugin/plugin.json 的 version 改成新版本号，在 CHANGELOG.md 里把「未发布」改成这个版本，一起提交
scripts/release.sh 0.3.1     # 跑测试、打 tag、把 marketplace.json 指到这个 tag，提交在本地
git push origin main v0.3.1  # 确认没问题再推
```

用户装的插件只跟 marketplace.json 里的 tag 走，main 上没发版的改动到不了别人手里。
