import type {
  TranscriptItem,
  TranscriptState,
} from "@anyharness/sdk";
import {
  getToolCallParsedCommands,
  getToolCallShellCommand,
  isExplorationParsedCommand,
} from "./transcript-tool-commands";
import {
  basename,
  deriveReadPath,
} from "../tools/collapsed-action-labels";

export type CollapsedActionKind =
  | "read"
  | "listing"
  | "search"
  | "fetch"
  | "command"
  | "edit"
  | "action";

export interface CurrentCollapsedAction {
  itemId: string;
  kind: CollapsedActionKind;
  label: string;
}

export interface CollapsedActionSummary {
  reads: number;
  listings: number;
  searches: number;
  fetches: number;
  commands: number;
  edits: number;
  actions: number;
}

/**
 * Resolve the one action that should own a live collapsed header. Completed
 * history remains available in the expanded ledger; the live surface never
 * turns the whole ledger into a cumulative "Running N commands" status.
 */
export function resolveCurrentCollapsedAction(
  itemIds: readonly string[],
  transcript: TranscriptState,
): CurrentCollapsedAction | null {
  const tools = itemIds
    .map((itemId) => transcript.itemsById[itemId])
    .filter((item): item is Extract<TranscriptItem, { kind: "tool_call" }> =>
      item?.kind === "tool_call"
    );
  const item = [...tools].reverse().find((candidate) =>
    candidate.status !== "completed" && candidate.status !== "failed"
  ) ?? tools[tools.length - 1];
  if (!item) {
    return null;
  }

  const parsedCommands = getToolCallParsedCommands(item);
  if (parsedCommands.length > 1) {
    return { itemId: item.itemId, kind: "command", label: "Running command" };
  }
  const parsed = parsedCommands.length > 0
    ? parsedCommands[parsedCommands.length - 1]
    : undefined;
  if (parsed) {
    const target = parsed.name
      ?? (parsed.path ? basename(parsed.path) : null);
    switch (parsed.kind) {
      case "read":
        return { itemId: item.itemId, kind: "read", label: `Reading ${target ?? "file"}` };
      case "listing":
        return { itemId: item.itemId, kind: "listing", label: `Listing ${target ?? "files"}` };
      case "search":
        return { itemId: item.itemId, kind: "search", label: "Searching files" };
      case "fetch":
        return { itemId: item.itemId, kind: "fetch", label: `Fetching ${target ?? "resource"}` };
      case "command":
        return { itemId: item.itemId, kind: "command", label: "Running command" };
      case "action":
        return { itemId: item.itemId, kind: "action", label: "Working" };
    }
  }

  const kind = classifyCollapsedAction(item);
  switch (kind) {
    case "read":
      return { itemId: item.itemId, kind, label: `Reading ${deriveCurrentReadTarget(item)}` };
    case "listing":
      return { itemId: item.itemId, kind, label: "Listing files" };
    case "search":
      return { itemId: item.itemId, kind, label: "Searching files" };
    case "fetch":
      return { itemId: item.itemId, kind, label: "Fetching resource" };
    case "command":
      return { itemId: item.itemId, kind, label: "Running command" };
    case "edit":
      return { itemId: item.itemId, kind, label: "Editing files" };
    case "action":
      return { itemId: item.itemId, kind, label: "Working" };
  }
}

function deriveCurrentReadTarget(
  item: Extract<TranscriptItem, { kind: "tool_call" }>,
): string {
  const fileRead = item.contentParts.find((part) => part.type === "file_read");
  if (fileRead?.basename) {
    return fileRead.basename;
  }
  const path = fileRead?.workspacePath ?? fileRead?.path;
  return path ? basename(path) : deriveReadPath(item);
}

export function summarizeCollapsedActions(
  itemIds: readonly string[],
  transcript: TranscriptState,
): CollapsedActionSummary {
  return itemIds.reduce<CollapsedActionSummary>(
    (summary, itemId) => {
      const item = transcript.itemsById[itemId];
      if (item?.kind !== "tool_call") {
        return summary;
      }

      const parsedSummary = summarizeParsedToolCommands(item);
      if (parsedSummary) {
        summary.reads += parsedSummary.reads;
        summary.listings += parsedSummary.listings;
        summary.searches += parsedSummary.searches;
        summary.fetches += parsedSummary.fetches;
        summary.commands += parsedSummary.commands;
        summary.actions += parsedSummary.actions;
        return summary;
      }

      switch (classifyCollapsedAction(item)) {
        case "read":
          summary.reads += countParts(item, "file_read");
          break;
        case "listing":
          summary.listings += 1;
          break;
        case "search":
          summary.searches += 1;
          break;
        case "fetch":
          summary.fetches += 1;
          break;
        case "command":
          summary.commands += 1;
          break;
        case "edit":
          summary.edits += countParts(item, "file_change");
          break;
        case "action":
          summary.actions += 1;
          break;
      }
      return summary;
    },
    { reads: 0, listings: 0, searches: 0, fetches: 0, commands: 0, edits: 0, actions: 0 },
  );
}

export function formatCollapsedActionsSummary(
  summary: CollapsedActionSummary,
): string {
  const fragments: string[] = [];

  // Match Codex's calm completed-activity voice. The expanded ledger owns
  // exact counts. One representative exploration phrase summarizes the whole
  // read/search/list/fetch family (copy priority: read > search > list > fetch)
  // so the collapsed row stays short even when the ledger is heterogeneous.
  if (summary.edits > 0) {
    fragments.push(summary.edits === 1 ? "edited a file" : "edited files");
  }

  if (summary.reads > 0) {
    fragments.push("read files");
  } else if (summary.searches > 0) {
    fragments.push("searched files");
  } else if (summary.listings > 0) {
    fragments.push("listed files");
  } else if (summary.fetches > 0) {
    fragments.push(summary.fetches === 1 ? "fetched a resource" : "fetched resources");
  }

  if (summary.commands > 0) {
    fragments.push(summary.commands === 1 ? "ran a command" : "ran commands");
  }
  if (summary.actions > 0) {
    fragments.push(summary.actions === 1 ? "ran an action" : "ran actions");
  }

  if (fragments.length === 0) {
    return "Working";
  }

  const sentence = fragments.join(", ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/**
 * Resolve the dominant completed-work glyph. Codex intentionally uses search
 * for mixed search/read groups even while its concise copy says "Read files".
 * Keep this shared so desktop and cloud cannot derive different icons.
 */
export function resolveCollapsedActionsLeadingKind(
  summary: CollapsedActionSummary,
): CollapsedActionKind {
  if (summary.edits > 0) return "edit";
  if (summary.searches > 0 || summary.listings > 0) return "search";
  if (summary.reads > 0) return "read";
  if (summary.fetches > 0) return "fetch";
  if (summary.commands > 0) return "command";
  return "action";
}

export function classifyCollapsedAction(
  item: Extract<TranscriptItem, { kind: "tool_call" }>,
): CollapsedActionKind {
  const nativeToolName = item.nativeToolName?.toLowerCase() ?? "";
  const toolKind = item.toolKind?.toLowerCase() ?? "";

  if (item.semanticKind === "file_change" || hasPart(item, "file_change")) {
    return "edit";
  }
  if (
    item.semanticKind === "file_read"
    || hasPart(item, "file_read")
    || nativeToolName === "read"
    || toolKind === "read"
  ) {
    return "read";
  }

  const parsedCommands = getToolCallParsedCommands(item);
  if (parsedCommands.length > 0) {
    if (parsedCommands.some((command) => !isExplorationParsedCommand(command.kind))) {
      return parsedCommands.every((command) => command.kind === "command")
        ? "command"
        : "action";
    }

    const firstKind = parsedCommands[0]?.kind ?? "search";
    return parsedCommands.every((command) => command.kind === firstKind)
      ? firstKind
      : "search";
  }

  if (nativeToolName === "ls" || toolKind === "list") {
    return "listing";
  }
  if (item.semanticKind === "search") {
    return "search";
  }
  if (item.semanticKind === "fetch") {
    return "fetch";
  }
  if (
    item.semanticKind === "terminal"
    || item.toolKind === "execute"
    || item.nativeToolName === "Bash"
    || hasPart(item, "terminal_output")
  ) {
    const shellCommand = getToolCallShellCommand(item);
    const parsedCommands = getToolCallParsedCommands(item);
    const shellKind = parsedCommands[0]?.kind ?? null;
    if (shellCommand && shellKind && isExplorationParsedCommand(shellKind)) {
      return shellKind;
    }
    return "command";
  }
  return "action";
}

function hasPart(
  item: Extract<TranscriptItem, { kind: "tool_call" }>,
  type: string,
): boolean {
  return item.contentParts.some((part) => part.type === type);
}

function countParts(
  item: Extract<TranscriptItem, { kind: "tool_call" }>,
  type: string,
): number {
  const count = item.contentParts.filter((part) => part.type === type).length;
  return Math.max(1, count);
}

function summarizeParsedToolCommands(
  item: Extract<TranscriptItem, { kind: "tool_call" }>,
): CollapsedActionSummary | null {
  const parsedCommands = getToolCallParsedCommands(item);
  if (parsedCommands.length === 0) {
    return null;
  }

  return parsedCommands.reduce<CollapsedActionSummary>(
    (summary, command) => {
      switch (command.kind) {
        case "read":
          summary.reads += 1;
          break;
        case "listing":
          summary.listings += 1;
          break;
        case "search":
          summary.searches += 1;
          break;
        case "fetch":
          summary.fetches += 1;
          break;
        case "command":
          summary.commands += 1;
          break;
        case "action":
          summary.actions += 1;
          break;
      }
      return summary;
    },
    { reads: 0, listings: 0, searches: 0, fetches: 0, commands: 0, edits: 0, actions: 0 },
  );
}
