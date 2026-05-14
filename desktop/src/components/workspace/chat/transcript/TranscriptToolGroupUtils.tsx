import type { ReactNode } from "react";
import type {
  ToolCallItem,
  TranscriptItem,
  TranscriptState,
} from "@anyharness/sdk";
import {
  ClipboardList,
  FileText,
  Settings,
} from "@/components/ui/icons";

export function collectDescendantItems(
  itemIds: readonly string[],
  transcript: TranscriptState,
  childrenByParentId: Map<string, string[]>,
): TranscriptItem[] {
  const out: TranscriptItem[] = [];
  for (const itemId of itemIds) {
    const item = transcript.itemsById[itemId];
    if (!item) continue;
    out.push(item);
    const childIds = childrenByParentId.get(itemId) ?? [];
    out.push(...collectDescendantItems(childIds, transcript, childrenByParentId));
  }
  return out;
}

export function hasRenderableToolDetails(item: ToolCallItem): boolean {
  return item.contentParts.some((part) => part.type !== "tool_call");
}

export function formatCollapsedSummary(summary: {
  messages: number;
  toolCalls: number;
  subagents: number;
}): string {
  return [
    pluralize(summary.messages, "message"),
    pluralize(summary.toolCalls, "tool call"),
    pluralize(summary.subagents, "subagent"),
  ]
    .filter((value): value is string => value !== null)
    .join(", ");
}

function pluralize(count: number, singular: string, plural?: string): string | null {
  if (count <= 0) {
    return null;
  }
  return `${count} ${count === 1 ? singular : (plural ?? singular + "s")}`;
}

export function buildCollapsedSummaryIcons(summary: {
  messages: number;
  toolCalls: number;
  subagents: number;
}): ReactNode[] {
  const icons: ReactNode[] = [];
  if (summary.messages > 0) {
    icons.push(<FileText key="messages" className="size-3.5" />);
  }
  if (summary.toolCalls > 0) {
    icons.push(<Settings key="tools" className="size-3.5" />);
  }
  if (summary.subagents > 0) {
    icons.push(<ClipboardList key="subagents" className="size-3.5" />);
  }
  return icons;
}

export function isSubagentItem(item: ToolCallItem): boolean {
  return item.nativeToolName === "Agent"
    || item.nativeToolName?.trim().toLowerCase() === "mcp__subagents__create_subagent";
}
