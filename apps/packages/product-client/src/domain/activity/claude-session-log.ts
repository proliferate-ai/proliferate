/**
 * Client-side, read-only translator from a Claude-CLI native session-log
 * JSONL tail (the bytes `open_tail_file` mirrors verbatim over a
 * subagent's `tail_file` feed — see
 * `anyharness-lib/src/domains/activity/feeds.rs`) into a `TranscriptState`
 * so `BackgroundSubagentView` can render a background claude subagent's
 * child transcript the same way any other transcript renders (Delivery Spec
 * — Background Work Slice 1, rung R4b; handoff's "Feed fidelity" note).
 *
 * No runtime or fork change backs this: the wire never translates Claude's
 * native log into ACP `SessionEventEnvelope`s for a background child, so
 * this module does it entirely in the client, from whatever bytes have
 * streamed in so far. It is a **pure, stateless recompute**: call it again
 * with the fuller buffer as more bytes arrive (`useClaudeSessionLogTranscript`
 * memoizes on the buffer text) rather than a stateful incremental parser
 * that retains a cursor — the feed buffer is already capped at 256KB
 * (`feed-content-buffer.ts`), so reparsing it whole on every chunk is cheap
 * and, unlike hidden parser state, can never desync from what is on screen.
 *
 * Honest subset mapped (everything else is skipped and counted, never
 * thrown): top-level `user` and `assistant` log lines; `text` and
 * `thinking` content blocks; `tool_use` blocks paired with their
 * `tool_result` by id. Skipped and counted: malformed JSON, any other
 * top-level `type` (`system`, `summary`, `queue-operation`, …), lines
 * flagged `isSidechain` (a *nested* Task-tool subagent inside this child —
 * one level of native-subagent nesting is out of this slice's scope, same
 * boundary the handoff draws for the top-level view), and a `tool_result`
 * whose `tool_use_id` never matched a `tool_use` seen in this buffer (an
 * orphan — expected at the front of a capped/truncated tail). The buffer's
 * trailing line is always held back and returned as `pendingPartialLine`:
 * `tail_file` streams raw bytes with no line-complete guarantee, and a
 * `\n`-free tail is indistinguishable from a write in flight.
 *
 * Reuses `@anyharness/sdk`'s own reducer (`reduceEvents`) rather than
 * hand-building `TranscriptState` — the same convergence point
 * `envelope-to-state.ts` already uses for the main transcript — so turn
 * bookkeeping, tool semantic-kind classification (native tool names like
 * `Bash`/`Task`/`Grep` are handled for free by the reducer's own
 * `nativeToolName` heuristics), and content-part shapes stay identical to a
 * live session's. Turns close (`turn_ended`) only when the next turn opens;
 * the buffer's final turn is left open, honestly reflecting that a
 * background child may still be writing to it. Envelope construction for
 * one parsed line's content blocks lives in `claude-session-log-envelopes.ts`
 * (split out purely for file size, FE-SIZE-1).
 */
import { reduceEvents, type SessionEventEnvelope, type StopReason, type TranscriptState } from "@anyharness/sdk";
import {
  emitAssistantLine,
  emitUserLine,
  extractUserText,
  isRecord,
  mapStopReason,
  type PendingToolUse,
} from "./claude-session-log-envelopes";

export interface ClaudeSessionLogTranscript {
  transcript: TranscriptState;
  /** Complete lines that were not part of the honest mapped subset (see module doc). */
  skippedLineCount: number;
  /** The buffer's held-back trailing line (may be empty). */
  pendingPartialLine: string;
}

interface ParsedLogLine {
  type: string;
  uuid: string;
  timestamp: string;
  isSidechain: boolean;
  message: Record<string, unknown> | null;
}

/**
 * Maps the accumulated `tail_file` buffer for one claude subagent into a
 * `TranscriptState`. Called fresh on every buffer growth (see module doc);
 * always terminates, never throws.
 */
export function claudeSessionLogToTranscriptState(
  buffer: string,
  sessionId: string,
): ClaudeSessionLogTranscript {
  const { completeLines, pendingPartialLine } = splitCompleteLines(buffer);

  const envelopes: SessionEventEnvelope[] = [];
  const pendingToolUses = new Map<string, PendingToolUse>();
  let skippedLineCount = 0;
  let seq = 0;
  let turnSeq = 0;
  let currentTurnId: string | null = null;
  let currentTurnStopReason: StopReason = "end_turn";

  const nextSeq = () => {
    seq += 1;
    return seq;
  };
  const closeCurrentTurn = (ts: string) => {
    if (!currentTurnId) {
      return;
    }
    envelopes.push({
      seq: nextSeq(),
      sessionId,
      timestamp: ts,
      turnId: currentTurnId,
      itemId: null,
      event: { type: "turn_ended", stopReason: currentTurnStopReason },
    });
  };

  completeLines.forEach((rawLine, lineIndex) => {
    const parsed = parseLogLine(rawLine, lineIndex);
    if (!parsed) {
      skippedLineCount += 1;
      return;
    }
    if (parsed.isSidechain || (parsed.type !== "user" && parsed.type !== "assistant")) {
      skippedLineCount += 1;
      return;
    }
    if (!parsed.message) {
      skippedLineCount += 1;
      return;
    }

    if (parsed.type === "user") {
      skippedLineCount += emitUserLine({
        content: parsed.message.content,
        timestamp: parsed.timestamp,
        pendingToolUses,
        nextSeq,
        sessionId,
        envelopes,
      });
      const text = extractUserText(parsed.message.content);
      if (text) {
        closeCurrentTurn(parsed.timestamp);
        turnSeq += 1;
        currentTurnId = `turn-${turnSeq}`;
        currentTurnStopReason = "end_turn";
        envelopes.push({
          seq: nextSeq(),
          sessionId,
          timestamp: parsed.timestamp,
          turnId: currentTurnId,
          itemId: `${parsed.uuid}:msg`,
          event: {
            type: "item_completed",
            item: {
              kind: "user_message",
              sourceAgentKind: "claude",
              status: "completed",
              contentParts: [{ type: "text", text }],
            },
          },
        });
      }
      return;
    }

    // Assistant line.
    if (!currentTurnId) {
      turnSeq += 1;
      currentTurnId = `turn-${turnSeq}`;
      currentTurnStopReason = "end_turn";
    }
    emitAssistantLine({
      content: parsed.message.content,
      timestamp: parsed.timestamp,
      uuid: parsed.uuid,
      turnId: currentTurnId,
      pendingToolUses,
      nextSeq,
      sessionId,
      envelopes,
    });
    currentTurnStopReason = mapStopReason(parsed.message.stop_reason);
  });

  const transcript = reduceEvents(envelopes, sessionId);
  return { transcript, skippedLineCount, pendingPartialLine };
}

/** Splits on `\n`, always holding back the trailing (possibly-partial) line. */
function splitCompleteLines(
  buffer: string,
): { completeLines: string[]; pendingPartialLine: string } {
  if (buffer.length === 0) {
    return { completeLines: [], pendingPartialLine: "" };
  }
  const parts = buffer.split("\n");
  const pendingPartialLine = parts[parts.length - 1] ?? "";
  const completeLines = parts.slice(0, -1).filter((line) => line.trim().length > 0);
  return { completeLines, pendingPartialLine };
}

function parseLogLine(rawLine: string, lineIndex: number): ParsedLogLine | null {
  let obj: unknown;
  try {
    obj = JSON.parse(rawLine);
  } catch {
    return null;
  }
  if (!isRecord(obj) || typeof obj.type !== "string") {
    return null;
  }
  const message = isRecord(obj.message) ? obj.message : null;
  return {
    type: obj.type,
    uuid: typeof obj.uuid === "string" && obj.uuid.length > 0 ? obj.uuid : `line-${lineIndex}`,
    timestamp: typeof obj.timestamp === "string" ? obj.timestamp : "",
    isSidechain: obj.isSidechain === true,
    message,
  };
}
