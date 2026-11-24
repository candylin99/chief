// 去掉文字里像密钥的东西（写日志、给面板看出错原因之前过一遍）：先换掉给定的，再按格式兜底。
// 认得的：Slack 的令牌和 cookie、GitHub 令牌、Atlassian API 令牌、JWT、Authorization / Bearer 后面的、URL 里的密码、token= / password= 这类。
const PATTERNS: RegExp[] = [
  /\b(xox[a-z]-|xoxe\.xox[a-z]-|xapp-|xoxd-)[A-Za-z0-9%-]+/g,
  /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g,
  /\bATAT[A-Za-z0-9_=-]{20,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g,
  /\b(Bearer|Basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
];

export function scrubTokens(text: string, tokens: readonly string[] = []): string {
  let out = text;
  for (const t of tokens) if (t) out = out.split(t).join("[令牌]");
  for (const p of PATTERNS) out = out.replace(p, (m) => (/^(Bearer|Basic|token)\s/i.test(m) ? `${m.split(/\s+/)[0]} [令牌]` : "[令牌]"));
  return out
    // https://user:secret@host → https://user:[令牌]@host
    .replace(/(\/\/[^/\s:@]+:)[^@\s/]+@/g, "$1[令牌]@")
    // authorization: xxx、token=xxx、"password":"xxx"、api_key=xxx
    .replace(/((?:authorization|password|passwd|secret|token|api[_-]?key|access[_-]?key)["']?\s*[:=]\s*["']?)[^\s"'&,;}]{4,}/gi, "$1[令牌]");
}
