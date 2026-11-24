# 导入用户现在在做的事

第一次开张、或用户点了「导入我现在在做的事」时照这个办：把他手上的事收进事情清单，之后同一件事的消息就会直接送进对应的会话。

1. **会话**：用 `list_sessions` 列出 Claude App 里的会话，只要最近 7 天动过的；跳过本会话、定时任务开的会话、明显是闲聊或试验的。每个会话记下：会话编号、标题、标题里的工单号 / PR（`PROJ-479`、`owner/repo#123`）。拿不准在做什么的，用 `get_session` 看一眼。
2. **Jira 和 GitHub**：`chief import`，拿到 `items`（`known` 为 true 的已经在清单里，跳过；`errors` 里有错就告诉用户哪个没拉到）。
3. **合并**：工单号、PR 对得上的，会话和单子算同一件事；对不上的，用 `search_session_transcripts` 在会话里搜一下工单号 / PR 号再确认。
4. **记进清单**，每件一次：

   ```
   chief thing add --import --title '<一句话概括>' --session <会话编号，有就带> --key <工单号> --key <PR 的键> [--due <Jira 的 due，有就带>] <<'EOF'
   {"progress": "<现在做到哪了>", "next": "<下一步，知道的话>", "blocker": "<卡在哪，有的话>"}
   EOF
   ```

   PR 的键写成 `github.com/<owner>/<repo>/pull/<号>`（全小写），和 `chief import` 给的 `key` 一样。有会话的，再 `chief route set --session <会话> --title '<同一个标题>' <所有键>`。
   - 导入这些：有会话的；Jira 状态是在做的（In Progress 这类）；用户开的 PR；等他 review 的 PR（status 用 `waiting_you`）。
   - **不导入**没有会话、状态还是 Open / On Hold / Released 这类的单：最后一条消息里列出来（每张一行：单号 + 标题），问用户要不要也放进来。
5. 跟用户说一句：「导入了 N 件：有会话的 a 件、Jira b 件、PR c 件；还有 d 张没开始 / 搁置的单没导入（列出来），要的话说一声」。
