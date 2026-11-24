# Security

chief reads messages written by other people, runs Claude sessions with broad permissions, and can send messages as you. This document describes what can go wrong, what the engine enforces, and what it cannot.

## Threat model

**Prompt injection through the hub.** The hub session and the work sessions it opens run in the bypass permissions mode: they execute commands and edit files without asking. They also read untrusted text (Slack messages, PR comments, Jira tickets, Notion comments). A crafted message may try to make a session run commands, leak local files or secrets, change chief's rules, or message other people. The hub skill tells the model to treat all external text as data and to ask you before any such action, but this is model behaviour, not a sandbox.

**Slack session cookie.** Slack access uses the `d` cookie from a browser login, not an official Slack app with scoped permissions. Whoever holds it has full access to your Slack account. chief stores it in the macOS Keychain (`chief:slack.cookie_d`). Some workspaces forbid this kind of access; check your policy.

**Local data in plaintext.** Events (including other people's messages), drafts, decisions and logs are stored unencrypted under `~/chief/data` (directory mode 0700, files 0600). Finished items move to `~/chief/data/archive/` after 7 days and are kept until you delete them.

## What the engine enforces

Sending is done by the engine, not by the model. Every outgoing message goes through a gate in the engine and CLI:

- A reply leaves the outbox only if (a) you clicked Send in the panel, (b) you said "send" in the hub and the plugin verifies it was text you typed (not a notification or another session's message), or (c) the engine's own policy check allows it. Panel and chat confirmations carry a confirm key held in the plugin's store; `~/chief/data` only keeps its fingerprint.
- Policy is computed by the engine: per-scenario settings, a trust list that matches Slack user IDs or exact full names only, quick replies that must match exactly and only answer incoming events, and an "always ask me" list (`askAlways`) that forces confirmation.
- Changes that loosen the policy (auto-send, trusting someone, adding quick replies) made without the confirm key become proposals that you accept in the panel.
- `approve` actions must reference the PR in the triggering event.
- Resetting the confirm key requires an interactive terminal and always notifies you.
- Text written into chief (titles, questions, progress) is checked for format; the engine rejects what does not pass.
- The engine recognises its own sent messages and does not feed them back as new events.

## Residual risks and limits

- Any process running as your OS user — including the hub session itself — can ultimately read and modify `~/chief`, read Keychain items it is allowed to, and call Slack directly with the cookie. The gate is a strong guardrail against mistakes and casual injection, plus tamper evidence (confirmations are recorded with what you said), **not a sandbox**.
- Concretely, a hub with shell access could bypass the `chief` CLI: edit `rules.json` / `replies.json` directly (the confirm hash is an unkeyed sha256 it can recompute), read the plugin's raw confirm key from the Claude plugin store, fake a terminal (`python3 -m pty`, `script`) to pass the `key reset` prompt, or delete `key-log.jsonl` before re-keying. Key changes are tamper-evident (notification plus a panel banner), not tamper-proof.
- Trust and always-ask entries written as display names can be spoofed by someone renaming themselves; prefer Slack user IDs.
- Work sessions can run arbitrary commands in their working directory. If you do not want that, do not use bypass permissions; approve commands one by one instead.
- chief cannot tell whether a trusted person's account was compromised.
- Rules you write in free text guide the hub's judgement; only the structured settings above are enforced by the engine.

If you need stronger isolation, run chief under a separate macOS user account.

## Reporting a vulnerability

Please report privately through GitHub: **Security → Report a vulnerability** on [jinjin99/chief](https://github.com/jinjin99/chief/security/advisories/new). Do not open a public issue. Include the version (`chief doctor` prints it), steps to reproduce, and impact. Remove tokens, cookies, workspace names and other people's messages from anything you attach.

---

## 中文摘要

- **风险：** 主会话和工作会话用 bypass permissions，又读别人写的消息，可能被提示词注入；Slack 用的是浏览器登录凭证（cookie），等于账号的全部权限，存在钥匙串里；收到的消息、回复稿、日志明文存在 `~/chief/data`，办完的 7 天后搬进 `data/archive/`，一直留着。
- **引擎管的：** 能发出去只有三条路（面板点发送、你亲口说「发」、引擎算出规矩允许）；白名单只认 Slack 用户编号或完整名字；固定回复一字不差、只回收到的消息；「一定问我」列表强制等你确认；主会话放宽规矩只能变成提议；approve 的 PR 必须是那条消息里的；重置钥匙要真终端、一定通知你。
- **管不了的：** 同一个系统用户下的任何进程（包括主会话自己）最终都能读改本地文件。发送把关是一道结实的护栏，也留下了谁确认过的记录，但不是沙箱。要更强的隔离，用单独的 macOS 用户跑。
- **报告漏洞：** 在 GitHub 上 jinjin99/chief 的 Security → Report a vulnerability 私下报告，不要开公开 issue。附件里去掉令牌、cookie、工作区名和别人的消息。
