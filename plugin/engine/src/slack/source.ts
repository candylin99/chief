// Slack 在来源名单里的那一份（见 sources/types.ts 的 SourceDescriptor）。
// Slack 是推送的：收消息、发回复都在 engine.ts 里接 SlackPlugin（要同一个连接），这里只管连、存 Cookie。
import { isStorableSecret } from "../secrets";
import { SOURCE_META } from "../shared/sources";
import type { SourceDescriptor } from "../sources/types";
import { loadSettings, paths, updateJson, type Settings } from "../store";
import { browserLogin, workspaceUrl } from "./login";
import { SLACK_COOKIE_D, SlackPlugin } from "./plugin";

export const slack: SourceDescriptor = {
  id: "slack",
  meta: SOURCE_META.slack,
  secret: `slack.${SLACK_COOKIE_D}`,
  // 默认开一个独立的 Chrome 窗口让你自己登录，拿到 Cookie 直接存进钥匙串，不经过剪贴板和聊天。
  // --workspace acme：从工作区地址登（公司 SSO 要这样）；不给就用上次登录成功时记下的。--stdin：从标准输入读 Cookie。
  async connect({ flag, has, secrets, readSecret, log }) {
    const given = flag("--workspace");
    const workspace = given ?? loadSettings().slackWorkspace;
    if (given !== null) workspaceUrl(given);
    const login = has("--stdin")
      ? { cookie: await readSecret("Slack 会话 Cookie（xoxd-…，输入不显示）：") }
      : await browserLogin({ log, ...(workspace ? { workspace } : {}) });
    const cookie = login.cookie;
    if (!isStorableSecret(cookie)) throw new Error("Cookie 里有不支持的字符");
    const checks = await new SlackPlugin().test({ [SLACK_COOKIE_D]: cookie });
    return {
      checks,
      save: async () => {
        await secrets.set(slack.secret!, cookie);
        // 记下这次登的工作区（你给的，或登录时看出来的），下次重新登录直接从工作区地址打开。
        const seen = given ?? ("workspace" in login ? login.workspace : undefined);
        if (seen) {
          const name = new URL(workspaceUrl(seen)).hostname.split(".")[0]!;
          updateJson<Partial<Settings>, void>(paths().settings, {}, (s) => { s.slackWorkspace = name; });
        }
      },
    };
  },
};
