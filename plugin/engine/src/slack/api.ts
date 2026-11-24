// 照搬 aide 的 channels/src/slack/api.ts。去掉令牌的办法挪到了 ../scrub.ts（GitHub、Jira 的出错原因也用它）。
export { scrubTokens } from "../scrub";
