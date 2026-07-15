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
  subagentId: string | null;
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

  // A native-Agent fire-and-forget async launch flips its launch tool-call to
  // status:"completed" the instant the launch receipt returns, while the
  // subagent keeps running. When the pending-background metadata is not
  // attached to this item's rawOutput, the checks above fall through and the
  // launch would be mis-classified as completed. Detect the bare launch
  // receipt (no structured summary yet) and treat it as still running so the
  // transcript stays quiet — the live subagent lives in the composer roster,
  // and the raw orchestration receipt never leaks into the transcript.
  if (isAsyncLaunchReceipt(item)) {
    return "background";
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
  const rawOutput: Record<string, unknown> = isRecord(item.rawOutput)
    ? item.rawOutput
    : (parseToolResultJsonObject(item) ?? {});
  const label = readStringField(rawInput, "label")
    ?? readStringField(rawOutput, "label");
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

  const rawText = extractToolResultText(item);
  if (rawText.length === 0) {
    return null;
  }

  const backgroundWork = getBackgroundWork(item);
  // A native-Agent async launch may or may not carry pending-background
  // metadata on this item's rawOutput. Recognise the launch receipt either
  // way: prefer the structured metadata, else fall back to the receipt text
  // signature. The final synthesized result replaces this text once the
  // subagent finishes, so this only ever matches the still-running receipt.
  if (backgroundWork?.state !== "pending" && !isLaunchReceiptText(rawText)) {
    return null;
  }

  return {
    rawText,
    agentId: backgroundWork?.agentId ?? null,
    outputFile: backgroundWork?.outputFile ?? null,
  };
}

/**
 * True when this item is a native-Agent background launch whose result is
 * still only the orchestration launch receipt (no final synthesized result
 * yet). Used to keep the transcript quiet while the subagent runs even when
 * the pending-background metadata is absent from rawOutput.
 */
function isAsyncLaunchReceipt(item: ToolCallItem): boolean {
  if (!isSubagent(item) || !readBooleanField(item.rawInput, "run_in_background")) {
    return false;
  }
  // If the parent already received a structured summary, the work is done.
  if (isRecord(item.rawOutput) && readStringField(item.rawOutput, "summary")) {
    return false;
  }
  return isLaunchReceiptText(extractToolResultText(item));
}

function isLaunchReceiptText(text: string): boolean {
  return /async agent launched/iu.test(text);
}

export function parseSubagentLaunchResult(
  item: ToolCallItem,
): SubagentLaunchResult | null {
  const provisioningStatus = parseSubagentProvisioningStatus(item);
  if (
    !provisioningStatus
    || (
      !provisioningStatus.subagentId
      && !provisioningStatus.sessionLinkId
      && !provisioningStatus.childSessionId
    )
  ) {
    return null;
  }

  return {
    subagentId: provisioningStatus.subagentId,
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

  const wake = isRecord(output.wake) ? output.wake : null;
  return {
    subagentId: readStringField(output, "subagentId"),
    sessionLinkId: readStringField(output, "sessionLinkId"),
    childSessionId: readStringField(output, "childSessionId"),
    promptStatus:
      readStringField(output, "promptStatus")
      ?? readStringField(output, "status"),
    wakeScheduled:
      readOptionalBooleanField(output, "wakeScheduled")
      ?? readOptionalBooleanField(output, "scheduled")
      ?? (wake ? readOptionalBooleanField(wake, "scheduled") : null),
    wakeScheduleCreated:
      readOptionalBooleanField(output, "wakeScheduleCreated")
      ?? readOptionalBooleanField(output, "created")
      ?? (wake ? readOptionalBooleanField(wake, "created") : null),
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
