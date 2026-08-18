/**
 * Envelope construction for `claude-session-log.ts`: turns one parsed
 * user/assistant log line's content blocks into the `SessionEventEnvelope`s
 * `@anyharness/sdk`'s reducer expects. Split out of the main module purely
 * for size (FE-SIZE-1) — see that module's doc comment for the mapping this
 * belongs to and the honest subset it implements.
 */
import type { SessionEventEnvelope, StopReason } from "@anyharness/sdk";

export const SOURCE_AGENT_KIND = "claude";

export interface PendingToolUse {
  turnId: string;
  nativeToolName: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function extractUserText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter(isRecord)
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => (block.text as string))
    .join("\n\n")
    .trim();
}

export function mapStopReason(rawStopReason: unknown): StopReason {
  if (rawStopReason === "max_tokens") {
    return "max_tokens";
  }
  if (rawStopReason === "refusal") {
    return "refusal";
  }
  return "end_turn";
}

function extractToolResultText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter(isRecord)
      .map((block) => (typeof block.text === "string" ? block.text : ""))
      .filter((text) => text.length > 0)
      .join("\n");
  }
  return "";
}

export interface EmitUserLineArgs {
  content: unknown;
  timestamp: string;
  pendingToolUses: Map<string, PendingToolUse>;
  nextSeq: () => number;
  sessionId: string;
  envelopes: SessionEventEnvelope[];
}

/**
 * Resolves this user line's `tool_result` blocks against open tool uses,
 * emitting an `item_completed` envelope for each match. Returns the count of
 * `tool_result` blocks whose `tool_use_id` matched nothing pending (an
 * orphan — expected at the front of a capped/truncated tail).
 */
export function emitUserLine(args: EmitUserLineArgs): number {
  const { content, timestamp, pendingToolUses, nextSeq, sessionId, envelopes } = args;
  if (!Array.isArray(content)) {
    return 0;
  }
  let orphanCount = 0;
  for (const block of content) {
    if (!isRecord(block) || block.type !== "tool_result") {
      continue;
    }
    const toolUseId = typeof block.tool_use_id === "string" ? block.tool_use_id : null;
    const pending = toolUseId ? pendingToolUses.get(toolUseId) : undefined;
    if (!toolUseId || !pending) {
      orphanCount += 1;
      continue;
    }
    pendingToolUses.delete(toolUseId);
    envelopes.push({
      seq: nextSeq(),
      sessionId,
      timestamp,
      turnId: pending.turnId,
      itemId: toolUseId,
      event: {
        type: "item_completed",
        item: {
          kind: "tool_invocation",
          sourceAgentKind: SOURCE_AGENT_KIND,
          status: block.is_error === true ? "failed" : "completed",
          nativeToolName: pending.nativeToolName,
          rawOutput: extractToolResultText(block.content),
          contentParts: [],
        },
      },
    });
  }
  return orphanCount;
}

export interface EmitAssistantLineArgs {
  content: unknown;
  timestamp: string;
  uuid: string;
  turnId: string;
  pendingToolUses: Map<string, PendingToolUse>;
  nextSeq: () => number;
  sessionId: string;
  envelopes: SessionEventEnvelope[];
}

/** Maps one assistant line's content blocks (text/thinking/tool_use) into item envelopes. */
export function emitAssistantLine(args: EmitAssistantLineArgs): void {
  const { content, timestamp, uuid, turnId, pendingToolUses, nextSeq, sessionId, envelopes } = args;
  const blocks = Array.isArray(content)
    ? content
    : typeof content === "string" && content.length > 0
      ? [{ type: "text", text: content }]
      : [];

  blocks.forEach((block, blockIndex) => {
    if (!isRecord(block)) {
      return;
    }
    if (block.type === "text" && typeof block.text === "string" && block.text.length > 0) {
      envelopes.push({
        seq: nextSeq(),
        sessionId,
        timestamp,
        turnId,
        itemId: `${uuid}:text:${blockIndex}`,
        event: {
          type: "item_completed",
          item: {
            kind: "assistant_message",
            sourceAgentKind: SOURCE_AGENT_KIND,
            status: "completed",
            contentParts: [{ type: "text", text: block.text }],
          },
        },
      });
      return;
    }
    if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking.length > 0) {
      envelopes.push({
        seq: nextSeq(),
        sessionId,
        timestamp,
        turnId,
        itemId: `${uuid}:thinking:${blockIndex}`,
        event: {
          type: "item_completed",
          item: {
            kind: "reasoning",
            sourceAgentKind: SOURCE_AGENT_KIND,
            status: "completed",
            contentParts: [{ type: "reasoning", text: block.thinking, visibility: "private" }],
          },
        },
      });
      return;
    }
    if (
      block.type === "tool_use"
      && typeof block.id === "string"
      && typeof block.name === "string"
    ) {
      const toolUseId = block.id;
      const nativeToolName = block.name;
      pendingToolUses.set(toolUseId, { turnId, nativeToolName });
      envelopes.push({
        seq: nextSeq(),
        sessionId,
        timestamp,
        turnId,
        itemId: toolUseId,
        event: {
          type: "item_started",
          item: {
            kind: "tool_invocation",
            sourceAgentKind: SOURCE_AGENT_KIND,
            status: "in_progress",
            nativeToolName,
            rawInput: block.input,
            contentParts: [{
              type: "tool_call",
              toolCallId: toolUseId,
              title: nativeToolName,
              nativeToolName,
            }],
          },
        },
      });
    }
    // Other block types (image, redacted_thinking, server_tool_use, …) are
    // outside the honest subset and are dropped without affecting the
    // line-level skipped count — the line itself IS in the mapped subset.
  });
}
