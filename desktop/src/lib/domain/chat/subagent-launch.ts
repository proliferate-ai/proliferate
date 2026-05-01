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

export interface SubagentLaunchDisplay {
  title: string;
  meta: string | null;
  prompt: string | null;
}

export interface SubagentLaunchResult {
  sessionLinkId: string | null;
  childSessionId: string | null;
}

export interface SubagentProvisioningStatus extends SubagentLaunchResult {
  promptStatus: string | null;
  wakeScheduled: boolean | null;
  wakeScheduleCreated: boolean | null;
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

export function isSubagentExecutionStateRunning(
  state: SubagentExecutionState,
): boolean {
  return state === "running" || state === "background";
}

export function isSubagentWorkComplete(item: ToolCallItem): boolean {
  return !isSubagentExecutionStateRunning(resolveSubagentExecutionState(item));
}

export function resolveSubagentLaunchDisplay(
  item: ToolCallItem,
): SubagentLaunchDisplay {
  const rawInput = isRecord(item.rawInput) ? item.rawInput : {};
  const label = readStringField(rawInput, "label");
  const prompt = readStringField(rawInput, "prompt") ?? extractToolInputText(item);
  const title = label
    ?? (isAnyHarnessSubagentTool(item) ? "Subagent" : item.title)
    ?? "Agent task";

  return {
    title,
    meta: null,
    prompt,
  };
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

export function parseSubagentLaunchResult(
  item: ToolCallItem,
): SubagentLaunchResult | null {
  const provisioningStatus = parseSubagentProvisioningStatus(item);
  if (!provisioningStatus || (!provisioningStatus.sessionLinkId && !provisioningStatus.childSessionId)) {
    return null;
  }

  return {
    sessionLinkId: provisioningStatus.sessionLinkId,
    childSessionId: provisioningStatus.childSessionId,
  };
}

export function parseSubagentProvisioningStatus(
  item: ToolCallItem,
): SubagentProvisioningStatus | null {
  if (!isSubagent(item)) {
    return null;
  }

  const output = isRecord(item.rawOutput)
    ? item.rawOutput
    : parseToolResultJsonObject(item);
  if (!output) {
    return null;
  }

  return {
    sessionLinkId: readStringField(output, "sessionLinkId"),
    childSessionId: readStringField(output, "childSessionId"),
    promptStatus: readStringField(output, "promptStatus"),
    wakeScheduled: readOptionalBooleanField(output, "wakeScheduled"),
    wakeScheduleCreated: readOptionalBooleanField(output, "wakeScheduleCreated"),
  };
}

function extractToolResultText(item: ToolCallItem): string {
  return item.contentParts
    .filter((part): part is ToolResultTextContentPart => part.type === "tool_result_text")
    .map((part) => part.text.trim())
    .filter((text) => text.length > 0)
    .join("\n\n");
}

function extractToolInputText(item: ToolCallItem): string | null {
  const text = item.contentParts
    .filter((part): part is Extract<ToolCallItem["contentParts"][number], { type: "tool_input_text" }> =>
      part.type === "tool_input_text"
    )
    .map((part) => part.text.trim())
    .filter((part) => part.length > 0)
    .join("\n\n");
  return text.length > 0 ? text : null;
}

function readStringField(value: Record<string, unknown>, key: string): string | null {
  const field = value[key];
  if (typeof field !== "string") {
    return null;
  }
  const trimmed = field.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBooleanField(value: unknown, key: string): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return value[key] === true;
}

function readOptionalBooleanField(value: Record<string, unknown>, key: string): boolean | null {
  const field = value[key];
  return typeof field === "boolean" ? field : null;
}

function parseToolResultJsonObject(item: ToolCallItem): Record<string, unknown> | null {
  const text = extractToolResultText(item).trim();
  if (!text.startsWith("{") || !text.endsWith("}")) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
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

function isAnyHarnessSubagentTool(item: ToolCallItem): boolean {
  return item.nativeToolName === "mcp__subagents__create_subagent";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
