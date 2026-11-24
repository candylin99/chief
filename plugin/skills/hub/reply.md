# 回复怎么发（收到「chief 回复 #N」时）

0. **先把关**：对着 `chief rules` 的「回复写法」看稿子。像报告（分小标题、贴推理过程、超过五六行、一堆数字）就收紧成同事聊天的口气，保留事实和链接。改动大的在汇报里说「稿子我收紧了」。
1. Write 到 `~/chief/data/drafts/<N>-<当前秒数>.md`，只写正文。放 thread 还是直接回、署名，chief 按规矩自动加；只有特殊情况才加 `--in thread` / `--in inline`（比如私信里同时聊好几件事）。
2. `chief reply add --event N --thing T --file <那个文件>`，返回回复号 R、场景 `scenario`、规矩 `policy`。要附图（只有 Slack）：加 `--image <路径>`，可写几次，最多 4 张，PNG / JPEG / GIF / WebP，单张 10MB 以内；图由工作会话做好给你完整路径。
3. 判断：
   - `policy` 是 `auto`（场景设了直接发，或 `"trusted": true`），或正文和某条固定回复一字不差，并且用户写的规矩没说这种要问（排期、承诺、拒绝等）：`chief reply queue R --policy`。成了说一句「按规矩 5 秒后替你回 <谁>：『正文前 40 字』，面板上能撤回」；报错就当下一种办。
   - 其他情况：放着，在待发出等用户。说一句「给 <谁> 的回复写好了，在面板『要你』页等你确认」，推送。
   - 用户回你「发吧」「可以发」：`chief reply ask-confirm R`（几条都发就每条都跑），再 `chief reply list --all`：`queued` / `sent` 才算发了；还是 `pending` 就说「在面板『要你』页点一下发送」，不要说已经发了。
4. Notion 的回复发不了（集成只读），把正文直接给用户。
