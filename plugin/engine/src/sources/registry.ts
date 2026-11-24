// 来源注册表：每个来源一份 SourceDescriptor（见 types.ts）。引擎、命令行都按它走，不写某个来源的分支。
// 类型要求 shared/sources.ts 名单里的每个来源都在这里有一份：名单里加了、这里没加，类型检查过不了。
import { SOURCE_IDS, isSourceId, type EventSource, type SourceId } from "../shared/sources";
import { slack } from "../slack/source";
import { github } from "./github";
import { jira } from "./jira";
import { notion } from "./notion";
import type { SourceDescriptor } from "./types";

export const SOURCES: Readonly<Record<SourceId, SourceDescriptor>> = { slack, github, jira, notion };

// 按名单的顺序。
export const DESCRIPTORS: readonly SourceDescriptor[] = SOURCE_IDS.map((id) => SOURCES[id]);

// 事件、回复的来源对应的那份（会话进展不是来源，没有）。
export function descriptorOf(source: EventSource): SourceDescriptor | null {
  return isSourceId(source) ? SOURCES[source] : null;
}
