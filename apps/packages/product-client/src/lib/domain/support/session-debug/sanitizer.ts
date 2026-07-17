import type { ContentPart } from "@anyharness/sdk";
import type { SessionDebugExportedSession } from "#product/lib/domain/support/session-debug/export-models";

const REDACTED_OBJECT_KEYS = new Set(["notification", "rawInput", "rawOutput"]);
// Keep only audited protocol shape. Unknown fields and discriminants remain
// useful as length placeholders without exposing future customer-controlled data.
const SAFE_OBJECT_KEYS = new Set([
  "actionCapabilities",
  "activeGoal",
  "activity",
  "additions",
  "agentKind",
  "appendContentParts",
  "attachmentId",
  "basename",
  "bodyMarkdown",
  "closedAt",
  "content",
  "contentParts",
  "createdAt",
  "currentValue",
  "data",
  "dataOriginalBytes",
  "dataTruncated",
  "decisionState",
  "decisionVersion",
  "deletions",
  "delta",
  "description",
  "dismissedAt",
  "endLine",
  "entries",
  "errorMessage",
  "errors",
  "event",
  "executionSummary",
  "exitCode",
  "id",
  "item",
  "itemId",
  "kind",
  "lastPromptAt",
  "line",
  "liveConfig",
  "mcpBindingSummaries",
  "message",
  "mimeType",
  "modeId",
  "model",
  "modelId",
  "name",
  "nativeResolutionState",
  "nativeSessionId",
  "nativeToolName",
  "newBasename",
  "newPath",
  "newWorkspacePath",
  "normalizedControls",
  "normalizedEvents",
  "notification",
  "notificationKind",
  "openTarget",
  "operation",
  "origin",
  "outcome",
  "patch",
  "patchOriginalBytes",
  "patchTruncated",
  "path",
  "pendingPrompts",
  "planId",
  "preview",
  "previewOriginalBytes",
  "previewTruncated",
  "promptCapabilities",
  "promptId",
  "promptProvenance",
  "providerApiKey",
  "queuedAt",
  "rawConfigOptions",
  "rawInput",
  "rawNotifications",
  "rawOutput",
  "requestedModeId",
  "requestedModelId",
  "replaceContentParts",
  "scope",
  "seq",
  "session",
  "sessionId",
  "signal",
  "size",
  "snapshotHash",
  "source",
  "sourceAgentKind",
  "sourceKind",
  "sourceSessionId",
  "startLine",
  "status",
  "systemPrompt",
  "terminalId",
  "text",
  "timestamp",
  "title",
  "toolCallId",
  "toolKind",
  "turnId",
  "type",
  "updatedAt",
  "uri",
  "visibility",
  "workspaceId",
  "workspacePath",
]);
const SAFE_TYPE_VALUES = new Set([
  "available_commands_update",
  "config_option_update",
  "current_mode_update",
  "error",
  "file_change",
  "file_read",
  "goal_cleared",
  "goal_met",
  "goal_updated",
  "image",
  "interaction_requested",
  "interaction_resolved",
  "item_completed",
  "item_delta",
  "item_started",
  "loop_fired",
  "loop_removed",
  "loop_upserted",
  "pending_prompt_added",
  "pending_prompt_removed",
  "pending_prompt_updated",
  "pending_prompts_reordered",
  "plan",
  "plan_reference",
  "process_upserted",
  "proposed_plan",
  "proposed_plan_decision",
  "reasoning",
  "resource",
  "resource_link",
  "review_run_updated",
  "session_ended",
  "session_info_update",
  "session_link_turn_completed",
  "session_started",
  "session_state_update",
  "subagent_turn_completed",
  "subagent_upserted",
  "terminal_output",
  "text",
  "tool_call",
  "tool_input_text",
  "tool_result_text",
  "turn_ended",
  "turn_started",
  "usage_update",
]);

export function sanitizeSessionDebugExportedSession(
  session: SessionDebugExportedSession,
): SessionDebugExportedSession {
  return sanitizeSessionDebugValue(session) as SessionDebugExportedSession;
}

export function sanitizeSessionDebugContentParts(parts: ContentPart[]): ContentPart[] {
  return sanitizeSessionDebugValue(parts, "contentParts") as ContentPart[];
}

function sanitizeSessionDebugValue(value: unknown, keyHint = ""): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return keyHint === "type" && SAFE_TYPE_VALUES.has(value)
      ? value
      : `[redacted:${value.length}]`;
  }
  if (typeof value !== "object") {
    return `[redacted:${String(value).length}]`;
  }
  if (REDACTED_OBJECT_KEYS.has(keyHint)) {
    return { redacted: true };
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeSessionDebugValue(item, keyHint));
  }

  const output: Record<string, unknown> = {};
  let redactedKeyIndex = 0;
  for (const [key, item] of Object.entries(value)) {
    const outputKey = SAFE_OBJECT_KEYS.has(key)
      ? key
      : `[redacted-key:${key.length}:${redactedKeyIndex++}]`;
    output[outputKey] = sanitizeSessionDebugValue(item, key);
  }
  return output;
}
