#!/usr/bin/env bash
# 发一个版本：scripts/release.sh 0.3.1
# 检查、跑测试、打 tag，把 marketplace.json 指到这个 tag，提交在本地。推不推由你决定，脚本最后打印推送命令。
# 用户装的插件只跟 marketplace.json 里的 tag 走，main 上没发版的改动到不了别人手里。
set -euo pipefail

v="${1:-}"
[[ "$v" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "用法：scripts/release.sh <版本号，比如 0.3.1>"; exit 1; }
cd "$(git rev-parse --show-toplevel)"

[ "$(git branch --show-current)" = "main" ] || { echo "要在 main 上发版"; exit 1; }
git diff --quiet && git diff --cached --quiet || { echo "有没提交的改动，先提交"; exit 1; }
have=$(node -p 'require("./plugin/.claude-plugin/plugin.json").version')
[ "$have" = "$v" ] || { echo "plugin/.claude-plugin/plugin.json 的 version 是 $have，先改成 $v 并提交"; exit 1; }
git rev-parse -q --verify "refs/tags/v$v" >/dev/null && { echo "v$v 已经有了"; exit 1; }

(cd plugin/engine && npm run typecheck && npm test)
claude plugin validate plugin
claude plugin test plugin

git tag -a "v$v" -m "chief $v"
sha=$(git rev-parse "v$v^{commit}")
REF="v$v" SHA="$sha" node -e '
  const fs = require("fs");
  const p = ".claude-plugin/marketplace.json";
  const m = JSON.parse(fs.readFileSync(p, "utf8"));
  const src = m.plugins.find((x) => x.name === "chief").source;
  src.ref = process.env.REF;
  src.sha = process.env.SHA;
  fs.writeFileSync(p, JSON.stringify(m, null, 2) + "\n");
'
git commit -q -m "发布 ${v}" -- .claude-plugin/marketplace.json
echo "已打 tag v${v}（${sha}），marketplace.json 已指过去并提交在本地。"
echo "确认没问题再推：git push origin main v${v}"
