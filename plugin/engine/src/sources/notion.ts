// 照搬 aide 的 engine/src/sources/notion.ts（只留拉动态）。
// Notion：用 Notion 的集成令牌（存在钥匙串里）。只看得到你在 Notion 里分享给这个集成的页面。
// 拉 since 之后改过的页面，和它们上面的新评论。只读：只发 GET 和搜索。
import { isStorableSecret } from "../secrets";
import { SOURCE_META } from "../shared/sources";
import type { SecretCheck } from "../slack/types";
import { SourceError, getJson, plain, type Source, type SourceDescriptor, type SourceItem } from "./types";

const API = "https://api.notion.com/v1";
const VERSION = "2022-06-28";
const MAX_PAGES = 30;
// 页面编号：32 位十六进制（地址里可能带连字符）。
const PAGE_ID = /([0-9a-f]{32})(?:[?#].*)?$/i;

export function notionPageId(ref: string): string | null {
  const m = PAGE_ID.exec(ref.trim().replace(/-/g, ""));
  return m ? m[1]!.toLowerCase() : null;
}

interface RichText { plain_text?: string }
interface Page { id: string; url: string; last_edited_time: string; properties?: Record<string, { type?: string; title?: RichText[] }> }

function titleOf(p: Page): string {
  for (const prop of Object.values(p.properties ?? {})) {
    if (prop.type === "title") return (prop.title ?? []).map((t) => t.plain_text ?? "").join("") || "（没标题）";
  }
  return "（没标题）";
}

export class NotionSource implements Source {
  readonly id = "notion" as const;
  readonly label = "Notion";
  private readonly headers: Record<string, string>;

  constructor(token: string, private readonly fetchFn: typeof fetch = fetch) {
    this.headers = { Authorization: `Bearer ${token}`, "Notion-Version": VERSION, "Content-Type": "application/json" };
  }

  private call(path: string, signal: AbortSignal, body?: unknown): Promise<unknown> {
    return getJson(this.fetchFn, `${API}${path}`, body === undefined ? { headers: this.headers } : { method: "POST", headers: this.headers, body: JSON.stringify(body) }, signal, "Notion");
  }

  async check(signal: AbortSignal): Promise<SecretCheck[]> {
    try {
      const me = await this.call("/users/me", signal) as { name?: string };
      const found = await this.call("/search", signal, { page_size: 1, filter: { property: "object", value: "page" } }) as { results?: unknown[] };
      return [
        { label: "Notion 能用这个令牌", pass: true, detail: `集成：${me.name ?? "?"}` },
        { label: "分享给它的页面", pass: (found.results ?? []).length > 0, detail: (found.results ?? []).length > 0 ? "看得到页面" : "还没有页面分享给这个集成：在 Notion 页面右上角「连接」里加上它" },
      ];
    } catch (error) {
      return [{ label: "Notion 能用这个令牌", pass: false, detail: error instanceof Error ? error.message : "没成功" }];
    }
  }

  async poll(since: Date, signal: AbortSignal): Promise<SourceItem[]> {
    const data = await this.call("/search", signal, {
      page_size: MAX_PAGES, filter: { property: "object", value: "page" }, sort: { direction: "descending", timestamp: "last_edited_time" },
    }) as { results?: Page[] };
    const pages = (data.results ?? []).filter((p) => Date.parse(p.last_edited_time) > since.getTime()).reverse();
    const items: SourceItem[] = [];
    for (const p of pages) {
      let said = "";
      try {
        const c = await this.call(`/comments?block_id=${encodeURIComponent(p.id)}&page_size=50`, signal) as { results?: { created_time: string; rich_text?: RichText[] }[] };
        said = (c.results ?? []).filter((x) => Date.parse(x.created_time) > since.getTime()).slice(-5)
          .map((x) => plain((x.rich_text ?? []).map((t) => t.plain_text ?? "").join(""), 200)).join("；");
      } catch (error) {
        // 集成没开「读评论」权限：只报页面改了。
        if (!(error instanceof SourceError) || !/40[13]/.test(error.message)) throw error;
      }
      const title = plain(titleOf(p), 120);
      items.push({
        externalId: `${p.id}@${p.last_edited_time}`,
        kind: "notion.page",
        title: `Notion「${title}」`,
        url: p.url,
        summary: `Notion 页面「${title}」改过了${said ? `；新评论：${said}` : ""}`,
        at: p.last_edited_time,
        payload: { pageId: p.id.replace(/-/g, "") },
        // 只看得到你本人分享给集成的页面：都算跟你直接有关。有新评论的算有人找你（看不出是谁写的）。
        mine: true,
        asks: said ? ["comment"] : [],
      });
    }
    return items;
  }

}

const SECRET = "notion.token";

export const notion: SourceDescriptor = {
  id: "notion",
  meta: SOURCE_META.notion,
  secret: SECRET,
  build: async ({ secrets }) => {
    const token = await secrets.get(SECRET);
    return token ? new NotionSource(token) : "钥匙串里没有令牌";
  },
  event: (item) => ({ key: `notion:${String(item.payload.pageId ?? "")}`, reply: { page: String(item.payload.pageId ?? "") } }),
  async connect({ secrets, signal, readSecret }) {
    const token = await readSecret("Notion 集成令牌（输入不显示）：");
    if (!isStorableSecret(token)) throw new Error("令牌里有不支持的字符");
    return { checks: await new NotionSource(token).check(signal), save: () => secrets.set(SECRET, token) };
  },
};
