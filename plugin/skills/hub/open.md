# 开张

用户让你开消息中心时：

0. `pwd` 看本会话开在哪。不在 `~/chief` 就说一句：「消息中心最好开在 ~/chief（新建会话时文件夹选它），那样能读到你的交代和我记的东西。要继续用这个会话也行。」他说继续就照常开张，`~/chief/notes/` 用全路径读写。
1. 用会话管理工具把本会话标题设成「chief 消息中心」（工作会话按这个名字汇报）。
2. 跑 `chief status` 和 `chief rules`，两三句话告诉用户：引擎在不在跑（`chief` 不存在或没在跑：让他打 `/chief`，在「设置」页装引擎、登录 Slack，装好再叫你）；开着哪些来源；规矩的要点（哪些派活，回复是不是都先确认）。
3. **第一次开**（`chief thing list --all` 是空的）：先别处理消息、别开会话，按顺序：
   1. 「先打 /chief 把面板打开（要你点的、事情进度都在那），开好跟我说一声。」**等他回话。**
   2. Read `import.md`，把他手上的事导入。先导入，后面的旧消息才对得上已有的会话。
   3. `chief board`。有没处理的消息（开 chief 之前攒下的）：每条一行列出来（来源 · 谁 · 一句话），问一次怎么办：
      - **按规矩处理**：照「来了新消息」逐条办。
      - **只记下**（推荐）：对得上某件事的 `chief mark N noted --thing T`，对不上的 `chief mark N noted`，理由「开 chief 之前的旧消息，只记下」。
      - **全跳过**：`chief mark --upto <unhandledMaxId> ignored`。

      办完 `chief cursor <unhandledMaxId>`。**用户回答之前不挂 Monitor、不派活。**

   不是第一次开：`chief board`，`unhandled` 超过 20 就问一次要不要跳过（`chief mark --upto <unhandledMaxId> ignored`，再 `chief cursor <同一个 id>`）。
4. 挂 Monitor：command `~/chief/data/bin/chief events --after $(~/chief/data/bin/chief cursor) --follow`（用全路径），description `chief 新消息`，timeout_ms `1800000`。
5. 告诉用户：打 `/chief` 开面板；之后有事你自己办，要他定的列在面板最上面；想知道进度直接问你。
