import type { ToolCallItem, TranscriptState } from "@anyharness/sdk";

export const SUBAGENT_COLOR_PALETTE = [
  "color-mix(in oklab, var(--color-terminal-blue) 68%, var(--color-muted-foreground) 32%)",
  "color-mix(in oklab, var(--color-terminal-magenta) 62%, var(--color-muted-foreground) 38%)",
  "color-mix(in oklab, var(--color-highlight-muted) 70%, var(--color-muted-foreground) 30%)",
  "color-mix(in oklab, var(--color-terminal-cyan) 66%, var(--color-muted-foreground) 34%)",
  "color-mix(in oklab, var(--color-link-foreground) 74%, var(--color-muted-foreground) 26%)",
  "color-mix(in oklab, var(--color-terminal-yellow) 58%, var(--color-muted-foreground) 42%)",
] as const;

export function resolveSubagentColor(seed: string | null | undefined): string {
  const normalized = seed?.trim() || "subagent";
  const index = hashString(normalized) % SUBAGENT_COLOR_PALETTE.length;
  return SUBAGENT_COLOR_PALETTE[index];
}

export function buildSubagentBrailleColorMap(
  transcript: TranscriptState,
): Map<string, string> {
  const colorMap = new Map<string, string>();

  for (const turnId of transcript.turnOrder) {
    const turn = transcript.turnsById[turnId];
    if (!turn) continue;

    for (const itemId of turn.itemOrder) {
      const item = transcript.itemsById[itemId];
      if (!isSubagentItem(item)) continue;

      const seed = item.toolCallId ?? item.itemId;
      if (colorMap.has(seed)) continue;

      colorMap.set(seed, resolveSubagentColor(seed));
    }
  }

  return colorMap;
}

export function resolveSubagentBrailleColor(
  colorMap: Map<string, string>,
  item: ToolCallItem,
): string | undefined {
  return colorMap.get(item.toolCallId ?? item.itemId);
}

function isSubagentItem(item: unknown): item is ToolCallItem {
  return !!item
    && typeof item === "object"
    && "kind" in item
    && item.kind === "tool_call"
    && "semanticKind" in item
    && "nativeToolName" in item
    && (item.semanticKind === "subagent" || item.nativeToolName === "Agent");
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
