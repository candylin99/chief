# 自己维护的 chief fork：怎么改面板

这是 `jinjin99/chief` 的 fork（candylin99/chief），本机 Claude App 的插件源已指向它。
`main` 固定在 **0.2.1**（就是本机正在跑的版本）；上游后来的 **0.4.0** 在 `upstream-main` 分支，想升级时再合。

## 面板代码在哪

都在 `plugin/hooks/`：

| 文件 | 管什么 |
|---|---|
| `views.tsx` | 面板的页面和布局（约 800 行，要改显示什么、怎么排就改它） |
| `data.ts` | 面板读的数据：从 `~/chief` 的引擎数据算出各页要展示的内容 |
| `actions.ts` | 面板上的按钮点下去做什么 |
| `register.tsx` | 把面板注册进 Claude App（`/chief` 命令、pane 定义） |
| `setup.tsx` | 初始化/设置向导页 |
| `hooks.json` | 插件 hooks 声明入口 |

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

（clone 里已配好 `upstream` = jinjin99/chief；`upstream-main` 分支存着换源那天上游的 0.4.0。）
注意：上游 0.4.0 升级时会更新引擎，合完先看 `plugin/engine/` 的改动再更新，别直接动 `~/chief/data/app`。

## 本机换源记录（2026-11-24）

- `~/.claude/settings.json` → `extraKnownMarketplaces.chief.source.repo` = `candylin99/chief`（原 `jinjin99/chief`）。
- `claude plugin marketplace update chief` 已重新 clone 到 `~/.claude/plugins/marketplaces/chief`，HEAD = fork main（0.2.1）。
- 已装插件缓存、`~/chief` 用户数据、引擎服务都没动。
- 上游曾重写历史：本机装的 commit `71e0c0e` 在新历史里对应 `023868a`，唯一差异是示例文案（上游把示例里的真实名字/单号洗掉了，如 `OPS-35121`→`PERF-35121`、`jk.yuan`→`bob.lee`），代码功能一致。
