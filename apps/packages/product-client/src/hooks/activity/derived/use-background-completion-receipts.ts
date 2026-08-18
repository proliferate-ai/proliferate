import { useEffect, useRef, useState } from "react";
import type { ActivitySubagentWire } from "#product/domain/activity/subagent";
import { isProcessRunning } from "#product/domain/activity/process";
import {
  deriveNewCompletionReceipts,
  type BackgroundCompletionReceipt,
} from "#product/domain/activity/background-completion-receipt";
import { useSessionActivityForSession } from "#product/hooks/activity/derived/use-session-activity";

interface ReceiptAccumulator {
  sessionId: string | null;
  runningProcessIds: Set<string>;
  runningAgentsById: Map<string, ActivitySubagentWire>;
  receiptedKeys: Set<string>;
}

function emptyAccumulator(sessionId: string | null): ReceiptAccumulator {
  return {
    sessionId,
    runningProcessIds: new Set(),
    runningAgentsById: new Map(),
    receiptedKeys: new Set(),
  };
}

/**
 * Accumulates inline completion receipts for a session by watching its
 * activity fold (bgwork r6). Mirrors `useBackgroundWorkFinishSignalTracking`'s
 * transition-detection shape: it reads the SAME per-session roster slice
 * (`useSessionActivityForSession`), remembers what it last saw running, and
 * appends a receipt the moment a process exits or a native subagent finishes.
 *
 * The accumulation is deliberately ephemeral (path b, disclosed defect D1):
 * receipts only cover completions observed while this hook is mounted for the
 * session — work already finished at mount (roster seed) is baselined, not
 * receipted, and nothing survives a reload. The wire fix that would make these
 * durable and correctly ordered is flagged for the wire rung.
 *
 * Switching `sessionId` resets the accumulator to that session's own baseline
 * rather than carrying receipts across sessions (this hook's host,
 * `SessionTranscriptPane`, is not remounted per session).
 */
export function useBackgroundCompletionReceipts(
  sessionId: string | null,
  anchorTurnId: string | null,
): BackgroundCompletionReceipt[] {
  const activity = useSessionActivityForSession(sessionId);
  const [receipts, setReceipts] = useState<BackgroundCompletionReceipt[]>([]);
  const accumulatorRef = useRef<ReceiptAccumulator>(emptyAccumulator(sessionId));
  // Read at observation time only, never a re-run trigger: a receipt is
  // stamped with whatever turn was latest when its completion was folded, so
  // the row model can interleave it right after that turn (bgwork r6 round 2).
  // The transcript growing a later (e.g. wake) turn must NOT restamp an
  // already-emitted receipt, hence a ref rather than an effect dependency.
  const anchorTurnIdRef = useRef(anchorTurnId);
  anchorTurnIdRef.current = anchorTurnId;

  useEffect(() => {
    let accumulator = accumulatorRef.current;
    if (accumulator.sessionId !== sessionId) {
      accumulator = emptyAccumulator(sessionId);
      accumulatorRef.current = accumulator;
      setReceipts([]);
    }

    if (!sessionId) {
      return;
    }

    const newReceipts = deriveNewCompletionReceipts({
      previousRunningProcessIds: accumulator.runningProcessIds,
      previousRunningAgentsById: accumulator.runningAgentsById,
      processes: activity.processes,
      agents: activity.agents,
      alreadyReceiptedKeys: accumulator.receiptedKeys,
      anchorTurnId: anchorTurnIdRef.current,
      nowMs: Date.now(),
    });
    if (newReceipts.length > 0) {
      for (const receipt of newReceipts) {
        accumulator.receiptedKeys.add(receipt.key);
      }
      setReceipts((previous) => [...previous, ...newReceipts]);
    }

    accumulator.runningProcessIds = new Set(
      activity.processes.filter(isProcessRunning).map((process) => process.id),
    );
    accumulator.runningAgentsById = new Map(
      activity.agents
        .filter((agent) => agent.status.status === "running")
        .map((agent) => [agent.id, agent] as const),
    );
  }, [sessionId, activity.processes, activity.agents]);

  return receipts;
}
