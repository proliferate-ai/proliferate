import type { ContentPart } from "@anyharness/sdk";
import type { SessionDebugExportedSession } from "#product/lib/domain/support/session-debug/export-models";
import {
  sessionDebugArrayElementNode,
  sessionDebugChildNode,
  sessionDebugPrimitiveKind,
  type SessionDebugPrimitiveKind,
  type SessionDebugSchemaNode,
} from "#product/lib/domain/support/session-debug/primitive-contracts";

const MAX_SANITIZER_DEPTH = 16;
const MAX_CONTAINER_ITEMS = 256;
const MAX_SANITIZED_VALUES = 10_000;
const REDACTED_OBJECT_KEYS = new Set([
  "availableCommands",
  "cost",
  "notification",
  "rawInput",
  "rawOutput",
  "sourceMetadata",
]);
// Keep only audited protocol shape. Unknown key names reveal only their length,
// while their values fail closed to a fixed marker.
const SAFE_OBJECT_KEYS = new Set([
  "acceptedFieldIds",
  "actionCapabilities",
  "activeGoal",
  "activeRoundId",
  "activity",
  "additions",
  "agent",
  "agentId",
  "agentKind",
  "agentType",
  "agents",
  "answeredQuestionIds",
  "appendContentParts",
  "appendReasoning",
  "appendText",
  "attachmentId",
  "audio",
  "autoIterate",
  "availableCommands",
  "background",
  "basename",
  "blockedPath",
  "bodyMarkdown",
  "category",
  "childLastEventSeq",
  "childSessionId",
  "childTurnId",
  "closedAt",
  "code",
  "collaborationMode",
  "command",
  "completionId",
  "content",
  "contentParts",
  "context",
  "cost",
  "createdAt",
  "currentModeId",
  "currentRoundNumber",
  "currentValue",
  "cwd",
  "data",
  "dataOriginalBytes",
  "dataTruncated",
  "decisionState",
  "decisionVersion",
  "decisionReason",
  "deletions",
  "delta",
  "description",
  "details",
  "dismissedAt",
  "displayName",
  "durationSeconds",
  "effort",
  "embeddedContext",
  "endedAt",
  "endLine",
  "entrypoint",
  "entries",
  "errorMessage",
  "errors",
  "event",
  "executionSummary",
  "exitCode",
  "expr",
  "extras",
  "fallbackModelId",
  "fastMode",
  "feed",
  "feedbackJobId",
  "feedId",
  "fieldId",
  "fieldType",
  "fields",
  "fireCount",
  "firedAtMs",
  "fork",
  "format",
  "goal",
  "hasLiveHandle",
  "header",
  "id",
  "image",
  "integer",
  "isOther",
  "isSecret",
  "isTransient",
  "item",
  "itemId",
  "iterations",
  "key",
  "kind",
  "label",
  "lastPromptAt",
  "lastFiredAtMs",
  "line",
  "limit",
  "liveConfig",
  "linkedPlanId",
  "loop",
  "loopId",
  "loops",
  "loopsNative",
  "maxItems",
  "maxLength",
  "maxRounds",
  "maximum",
  "mcpBindingSummaries",
  "message",
  "messageId",
  "metReason",
  "mimeType",
  "minItems",
  "minLength",
  "minimum",
  "mode",
  "modeId",
  "model",
  "modelId",
  "name",
  "native",
  "nativeResolutionState",
  "nativeSessionId",
  "nativeStatus",
  "nativeToolName",
  "newBasename",
  "newPath",
  "newWorkspacePath",
  "normalizedControls",
  "normalizedEvents",
  "notification",
  "notificationKind",
  "objective",
  "openTarget",
  "operation",
  "optionId",
  "options",
  "origin",
  "outcome",
  "parentSessionId",
  "parentToolCallId",
  "patch",
  "patchOriginalBytes",
  "patchTruncated",
  "path",
  "payload",
  "pendingInteractions",
  "pendingPrompts",
  "phase",
  "pid",
  "planId",
  "preview",
  "previewOriginalBytes",
  "previewTruncated",
  "promptCapabilities",
  "promptId",
  "prompt",
  "promptProvenance",
  "process",
  "processes",
  "provider",
  "providerModel",
  "questions",
  "question",
  "questionId",
  "queuedAt",
  "rawConfigOptions",
  "rawConfigId",
  "rawInput",
  "rawNotifications",
  "rawOutput",
  "reason",
  "reasoning",
  "recurring",
  "relation",
  "required",
  "requestId",
  "requiresReveal",
  "requestedModeId",
  "requestedModelId",
  "replaceContentParts",
  "revision",
  "reviewRunId",
  "reviewRoundId",
  "schedule",
  "scope",
  "seq",
  "serverName",
  "settable",
  "session",
  "sessionId",
  "sessionLinkId",
  "signal",
  "size",
  "snapshotHash",
  "source",
  "sourceAgentKind",
  "sourceItemId",
  "sourceKind",
  "sourceMetadata",
  "sourceSeq",
  "sourceSessionId",
  "sourceToolCallId",
  "sourceTurnId",
  "startLine",
  "startedAt",
  "status",
  "stopReason",
  "supportsGoals",
  "supportsLoops",
  "summary",
  "targetedFork",
  "terminalId",
  "text",
  "textOriginalBytes",
  "textTruncated",
  "timeUsedSeconds",
  "timestamp",
  "title",
  "tokenBudget",
  "tokensUsed",
  "toolCallId",
  "toolCalls",
  "toolKind",
  "toolStatus",
  "transport",
  "turn",
  "turnId",
  "type",
  "unit",
  "updatedAt",
  "updatedAtMs",
  "uri",
  "usage",
  "used",
  "urlDisplay",
  "value",
  "values",
  "visibility",
  "workspaceId",
  "workspacePath",
]);
const SAFE_TYPE_VALUES = new Set([
  "agentSession",
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
  "linkWake",
  "mcp_elicitation",
  "pending_prompt_added",
  "pending_prompt_removed",
  "pending_prompt_updated",
  "pending_prompts_reordered",
  "plan",
  "plan_reference",
  "process_upserted",
  "permission",
  "proposed_plan",
  "proposed_plan_decision",
  "reasoning",
  "resource",
  "resource_link",
  "review_run_updated",
  "reviewFeedback",
  "select",
  "session_ended",
  "session_info_update",
  "session_link_turn_completed",
  "session_started",
  "session_state_update",
  "subagent_turn_completed",
  "subagent_upserted",
  "subagentWake",
  "system",
  "terminal_output",
  "text",
  "tool_call",
  "tool_input_text",
  "tool_result_text",
  "turn_ended",
  "turn_started",
  "usage_update",
  "user_input",
]);
interface SanitizerContext {
  remainingValues: number;
  seen: WeakSet<object>;
}

export function sanitizeSessionDebugExportedSession(
  session: SessionDebugExportedSession,
): SessionDebugExportedSession {
  return sanitizeSessionDebugValue(
    session,
    "",
    "exportedSession",
    createContext(),
  ) as SessionDebugExportedSession;
}

export function sanitizeSessionDebugContentParts(parts: ContentPart[]): ContentPart[] {
  return sanitizeSessionDebugValue(
    parts,
    "contentParts",
    "contentPartList",
    createContext(),
  ) as ContentPart[];
}

function sanitizeSessionDebugValue(
  value: unknown,
  keyHint: string,
  schemaNode: SessionDebugSchemaNode,
  context: SanitizerContext,
  depth = 0,
  primitiveKind?: SessionDebugPrimitiveKind,
): unknown {
  if (!consumeBudget(context)) {
    return redactedMarker();
  }
  if (value == null) {
    return value;
  }
  if (primitiveKind === "number") {
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : redactedMarker();
  }
  if (primitiveKind === "boolean") {
    return typeof value === "boolean" ? value : redactedMarker();
  }
  if (typeof value === "number") {
    return redactedMarker();
  }
  if (typeof value === "boolean") {
    return redactedMarker();
  }
  if (typeof value === "string") {
    return keyHint === "type" && SAFE_TYPE_VALUES.has(value)
      ? value
      : `[redacted:${value.length}]`;
  }
  if (typeof value !== "object") {
    return redactedMarker();
  }
  if (REDACTED_OBJECT_KEYS.has(keyHint)) {
    return redactedMarker();
  }
  if (depth >= MAX_SANITIZER_DEPTH || context.seen.has(value)) {
    return redactedMarker();
  }
  context.seen.add(value);
  if (Array.isArray(value)) {
    return sanitizeArray(value, schemaNode, context, depth);
  }

  return sanitizeObject(value, schemaNode, context, depth);
}

function sanitizeArray(
  value: unknown[],
  schemaNode: SessionDebugSchemaNode,
  context: SanitizerContext,
  depth: number,
): unknown[] {
  const output: unknown[] = [];
  let itemCount: number;
  try {
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !lengthDescriptor
      || !("value" in lengthDescriptor)
      || typeof lengthDescriptor.value !== "number"
      || !Number.isSafeInteger(lengthDescriptor.value)
      || lengthDescriptor.value < 0
    ) {
      return consumeBudget(context) ? [redactedMarker()] : output;
    }
    itemCount = Math.min(lengthDescriptor.value, MAX_CONTAINER_ITEMS);
  } catch {
    return consumeBudget(context) ? [redactedMarker()] : output;
  }
  const elementNode = sessionDebugArrayElementNode(schemaNode);
  for (let index = 0; index < itemCount && context.remainingValues > 0; index += 1) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor)) {
        if (consumeBudget(context)) {
          output.push(redactedMarker());
        }
        continue;
      }
      output.push(sanitizeSessionDebugValue(
        descriptor.value,
        "",
        elementNode,
        context,
        depth + 1,
      ));
    } catch {
      if (consumeBudget(context)) {
        output.push(redactedMarker());
      }
    }
  }
  return output;
}

function sanitizeObject(
  value: object,
  schemaNode: SessionDebugSchemaNode,
  context: SanitizerContext,
  depth: number,
): Record<string, unknown> | { redacted: true } {
  const output: Record<string, unknown> = {};
  let redactedKeyIndex = 0;
  let enumeratedKeys = 0;
  try {
    for (const key in value as Record<string, unknown>) {
      if (enumeratedKeys >= MAX_CONTAINER_ITEMS || context.remainingValues <= 0) {
        break;
      }
      enumeratedKeys += 1;
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        continue;
      }

      if (!SAFE_OBJECT_KEYS.has(key)) {
        if (!consumeBudget(context)) {
          break;
        }
        output[`[redacted-key:${key.length}:${redactedKeyIndex++}]`] = redactedMarker();
        continue;
      }

      if (REDACTED_OBJECT_KEYS.has(key)) {
        if (!consumeBudget(context)) {
          break;
        }
        output[key] = redactedMarker();
        continue;
      }

      try {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !("value" in descriptor)) {
          if (consumeBudget(context)) {
            output[key] = redactedMarker();
          }
          continue;
        }
        output[key] = sanitizeSessionDebugValue(
          descriptor.value,
          key,
          sessionDebugChildNode(schemaNode, key, value),
          context,
          depth + 1,
          sessionDebugPrimitiveKind(schemaNode, key, value),
        );
      } catch {
        if (consumeBudget(context)) {
          output[key] = redactedMarker();
        }
      }
    }
  } catch {
    return redactedMarker();
  }
  return output;
}

function createContext(): SanitizerContext {
  return {
    remainingValues: MAX_SANITIZED_VALUES,
    seen: new WeakSet<object>(),
  };
}

function consumeBudget(context: SanitizerContext): boolean {
  if (context.remainingValues <= 0) {
    return false;
  }
  context.remainingValues -= 1;
  return true;
}

function redactedMarker(): { redacted: true } {
  return { redacted: true };
}
