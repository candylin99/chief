#!/bin/sh
# chief 设置页的「装引擎 / 更新引擎」：建工作目录 ~/chief，把插件里的引擎代码放到 ~/chief/data/app，装依赖，装进 launchd。
# 新版先在 app.new 里装好、试过再换上去，旧的留成 app.prev；中途失败原来的引擎不动，退出码不是 0。
# 放到插件外面，是因为插件每升一版目录就换一个，launchd 要一个不变的位置。
set -eu
PLUGIN=$(cd "$(dirname "$0")" && pwd)
WS=$HOME/chief
DATA=${CHIEF_HOME:-$WS/data}
APP=$DATA/app

# 同一时间只跑一个：插件在几个会话里同时加载、都发现引擎旧了，只让第一个更新。锁超过 15 分钟算上次没收尾。
mkdir -p "$DATA"
LOCK=$DATA/.updating
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +15 2>/dev/null)" ]; then
    rmdir "$LOCK" && mkdir "$LOCK"
  else
    echo "已经有别的会话在更新引擎了"
    exit 0
  fi
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

# App 起的进程 PATH 不全：先问登录 shell，再看 Homebrew 的常见位置。
NODE=$(/bin/zsh -lc 'command -v node' 2>/dev/null || true)
[ -x "${NODE:-}" ] || for c in /opt/homebrew/bin/node /usr/local/bin/node; do
  if [ -x "$c" ]; then NODE=$c; break; fi
done
if [ ! -x "${NODE:-}" ]; then echo "没找到 node：先装 Node 24 以上（https://nodejs.org）"; exit 2; fi
MAJOR=$("$NODE" -p 'process.versions.node.split(".")[0]')
if [ "$MAJOR" -lt 24 ]; then echo "node 是 $("$NODE" -v)，要 24 以上"; exit 2; fi
BIN=$(dirname "$NODE")

# 新版先装在旁边的 app.new 里，装好、试过能加载再换上去：断网、npm 出错时原来的引擎一点不动，launchd 照旧跑旧的。
# 换的时候旧的留成 app.prev（要退回就把它改名回 app）。
NEW=$DATA/app.new
PREV=$DATA/app.prev
chmod 700 "$DATA"
rm -rf "$NEW"
echo "准备新引擎（${NEW}）"
mkdir -p "$NEW"
cp -R "$PLUGIN/engine/src" "$NEW/src"
cp "$PLUGIN/engine/package.json" "$PLUGIN/engine/package-lock.json" "$NEW/"
sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$PLUGIN/.claude-plugin/plugin.json" | head -n 1 > "$NEW/VERSION"

echo "装依赖（第一次要一两分钟）"
if ! (cd "$NEW" && PATH="$BIN:$PATH" "$BIN/npm" ci --omit=dev --no-audit --no-fund --loglevel=error); then
  rm -rf "$NEW"
  echo "装依赖没成功（断网了？）：引擎没动，还是原来的版本。联网后在设置页点「更新引擎」再试" >&2
  exit 3
fi

# 试一下新引擎能不能加载：tsx 能跑、引擎的代码和依赖都找得到（只加载，不启动）。
if ! (cd "$NEW" && "$NODE" --import ./node_modules/tsx/dist/esm/index.mjs -e 'Promise.all([import(process.argv[1]), import("gabriel-slack")]).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); })' "$NEW/src/engine.ts"); then
  rm -rf "$NEW"
  echo "新引擎加载不了：引擎没动，还是原来的版本" >&2
  exit 3
fi

# 换上去：旧的改名成 app.prev，新的改名成 app（同一个目录里改名，一下就换好）。
rm -rf "$PREV"
if [ -d "$APP" ]; then mv "$APP" "$PREV"; fi
if ! mv "$NEW" "$APP"; then
  if [ -d "$PREV" ]; then mv "$PREV" "$APP"; fi
  echo "换新引擎没成功：退回原来的版本" >&2
  exit 3
fi
if [ -d "$PREV" ]; then echo "新引擎换好了：${APP}（上一版留在 ${PREV}）"; else echo "新引擎装好了：${APP}"; fi

# 工作目录：消息中心开在这里，放你的交代（CLAUDE.md）、助理记下的东西（notes/）和自己的 skill。
# 只补没有的文件，已有的一个字都不动。
echo "工作目录 ${WS}（已有的文件不动）"
(cd "$PLUGIN/workspace" && find . -type f) | while IFS= read -r f; do
  if [ ! -e "$WS/$f" ]; then mkdir -p "$WS/$(dirname "$f")"; cp "$PLUGIN/workspace/$f" "$WS/$f"; fi
done

echo "装进 launchd"
if ! "$NODE" --import "$APP/node_modules/tsx/dist/esm/index.mjs" "$APP/src/cli.ts" install; then
  # 新引擎装不进 launchd：退回上一版，用它重新装一遍，别让 launchd 一直拉起一个起不来的引擎。
  if [ -d "$PREV" ]; then
    echo "新引擎装不进 launchd：退回上一版" >&2
    rm -rf "$APP.failed"
    mv "$APP" "$APP.failed" && mv "$PREV" "$APP" && "$NODE" --import "$APP/node_modules/tsx/dist/esm/index.mjs" "$APP/src/cli.ts" install || true
  fi
  echo "引擎没更新成功，看上面的出错原因" >&2
  exit 3
fi
