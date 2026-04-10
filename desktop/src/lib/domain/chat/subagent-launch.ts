import type {
  ToolBackgroundWorkMetadata,
  ToolCallItem,
  ToolResultTextContentPart,
} from "@anyharness/sdk";
import { parseToolBackgroundWork } from "@anyharness/sdk";

export type SubagentExecutionState =
  | "running"
  | "background"
  | "completed_background"
  | "expired_background"
  | "completed"
  | "failed";

export interface AsyncSubagentLaunch {
  rawText: string;
  agentId: string | null;
  outputFile: string | null;
}

export function resolveSubagentExecutionState(
  item: ToolCallItem,
): SubagentExecutionState {
  if (item.status === "failed") {
    return "failed";
  }

  if (item.status === "in_progress") {
    return "running";
  }

  const backgroundWork = getBackgroundWork(item);
  if (backgroundWork?.state === "pending") {
    return "background";
  }

  if (backgroundWork?.state === "expired") {
    return "expired_background";
  }

  if (backgroundWork?.state === "completed") {
    return "completed_background";
  }

  return wasLaunchedInBackground(item) ? "completed_background" : "completed";
}

export function parseAsyncSubagentLaunch(
  item: ToolCallItem,
): AsyncSubagentLaunch | null {
  if (!isSubagent(item)) {
    return null;
  }

  if (!readBooleanField(item.rawInput, "run_in_background")) {
    return null;
  }

  const backgroundWork = getBackgroundWork(item);
  if (!backgroundWork || backgroundWork.state !== "pending") {
    return null;
  }

  const rawText = extractToolResultText(item);
  if (rawText.length === 0) {
    return null;
  }

  return {
    rawText,
    agentId: backgroundWork.agentId,
    outputFile: backgroundWork.outputFile,
  };
}

function extractToolResultText(item: ToolCallItem): string {
  return item.contentParts
    .filter((part): part is ToolResultTextContentPart => part.type === "tool_result_text")
    .map((part) => part.text.trim())
    .filter((text) => text.length > 0)
    .join("\n\n");
}

function readBooleanField(value: unknown, key: string): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return value[key] === true;
}

function wasLaunchedInBackground(item: ToolCallItem): boolean {
  return isSubagent(item) && readBooleanField(item.rawInput, "run_in_background");
}

function getBackgroundWork(item: ToolCallItem): ToolBackgroundWorkMetadata | null {
  return parseToolBackgroundWork(item.rawOutput);
}

function isSubagent(item: ToolCallItem): boolean {
  return item.nativeToolName === "Agent" || item.semanticKind === "subagent";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
