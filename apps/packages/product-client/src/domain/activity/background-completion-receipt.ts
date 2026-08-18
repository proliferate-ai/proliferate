/**
 * Inline background-work completion receipts (bgwork r6). When a background
 * terminal exits or a native subagent finishes, the transcript shows a
 * right-aligned receipt row at the tail (Design Handoff — "Chat - Background
 * Work Indicator"; Delivery Spec — Background Work Slice 1, rung R6).
 *
 * ARCHITECTURE (path b — synthesized from the activity fold):
 * The runtime carries NO identifying provenance for native BACKGROUND
 * completions. Background terminals inject no session wake prompt at all
 * (`anyharness-lib/.../terminals/command_runs` only writes shell-prompt
 * bytes, never a `PromptProvenance`), and native roster subagents leave the
 * roster the instant they finish with no durable transcript record — the only
 * evidence is a roster departure (`use-background-work-finish-signal-tracking`,
 * rung R5). The `subagentWake`/`linkWake` provenance the transcript's
 * `AgentOriginPromptReceipt` already renders is for delegated/linked SESSIONS
 * (cowork/review/agent-parent), a different mechanism — not "background work."
 *
 * So receipts are synthesized from fold transitions: a process last seen
 * running that is now exited, or a native subagent last seen running that is
 * now finished-in-place or vanished. These are appended at the transcript tail
 * at fold time; they do not survive reload (known lane defect D1: activity
 * rendering is fold-only — the durable wire signal is the wire rung's job).
 */

import type { ActivityProcessWire } from "./process";
import { isProcessRunning } from "./process";
import type { ActivitySubagentWire } from "./subagent";
import { subagentDisplayTitle } from "./subagent";

/**
 * The transcript turn that was latest at the moment this completion was
 * observed (bgwork r6 round 2). Receipts interleave into the transcript row
 * sequence AFTER this turn's rows (see `bucketCompletionReceiptRows`), so a
 * background finish reads in stream order — agent turn → receipt → wake turn —
 * rather than piling up detached at the tail. `null` when no turn existed yet.
 */
interface CompletionReceiptAnchor {
  anchorTurnId: string | null;
}

export interface TerminalCompletionReceipt extends CompletionReceiptAnchor {
  kind: "terminal";
  /** Stable de-dupe/react key. */
  key: string;
  processId: string;
  command: string;
  exitCode: number | null;
  /** Real, server-stamped `endedAt` when present; else the detection time. */
  atMs: number;
}

export interface SubagentCompletionReceipt extends CompletionReceiptAnchor {
  kind: "subagent";
  key: string;
  subagentId: string;
  title: string;
  outcome: "completed" | "failed";
  /** Detection time — a finished subagent has no real, knowable finish time client-side (R5). */
  atMs: number;
}

export type BackgroundCompletionReceipt =
  | TerminalCompletionReceipt
  | SubagentCompletionReceipt;

/** Matches the design artifact's "exited 0 ·" verb; drops the code when the harness reports none. */
export function terminalReceiptVerb(exitCode: number | null): string {
  return exitCode === null ? "exited ·" : `exited ${exitCode} ·`;
}

/** Founder markup uses "finished ·"; a failed subagent reads "failed ·", matching `formatAgentMessageReceiptVerb`. */
export function subagentReceiptVerb(outcome: "completed" | "failed"): string {
  return outcome === "failed" ? "failed ·" : "finished ·";
}

export function terminalReceiptKey(processId: string): string {
  return `terminal:${processId}`;
}

export function subagentReceiptKey(subagentId: string): string {
  return `subagent:${subagentId}`;
}

/**
 * Pure transition diff: given the ids/entries last seen RUNNING and the
 * current roster, return receipts for work that has JUST finished — a running
 * process now exited, or a running subagent now finished-in-place (its final
 * status still on the roster for one tick) or vanished entirely.
 *
 * Only transitions from a previously-observed running state produce a receipt.
 * Work already finished at first sighting (roster seed on mount) is NOT
 * receipted — receipts announce completions that happen while watching, never
 * a backlog. `alreadyReceiptedKeys` guards against re-emitting the same
 * completion across ticks.
 */
export function deriveNewCompletionReceipts({
  previousRunningProcessIds,
  previousRunningAgentsById,
  processes,
  agents,
  alreadyReceiptedKeys,
  anchorTurnId,
  nowMs,
}: {
  previousRunningProcessIds: ReadonlySet<string>;
  previousRunningAgentsById: ReadonlyMap<string, ActivitySubagentWire>;
  processes: readonly ActivityProcessWire[];
  agents: readonly ActivitySubagentWire[];
  alreadyReceiptedKeys: ReadonlySet<string>;
  /**
   * The transcript's latest turn id at observation time, stamped onto every
   * receipt this call produces so the row model can interleave it right after
   * that turn (bgwork r6 round 2). Pass `null` when no turn exists yet.
   */
  anchorTurnId: string | null;
  nowMs: number;
}): BackgroundCompletionReceipt[] {
  const receipts: BackgroundCompletionReceipt[] = [];
  const currentAgentsById = new Map(agents.map((agent) => [agent.id, agent] as const));

  for (const process of processes) {
    if (isProcessRunning(process)) {
      continue;
    }
    if (!previousRunningProcessIds.has(process.id)) {
      continue;
    }
    const key = terminalReceiptKey(process.id);
    if (alreadyReceiptedKeys.has(key)) {
      continue;
    }
    receipts.push({
      kind: "terminal",
      key,
      processId: process.id,
      command: process.command,
      exitCode: process.status.status === "exited" ? process.status.exitCode : null,
      atMs: process.endedAt ? Date.parse(process.endedAt) || nowMs : nowMs,
      anchorTurnId,
    });
  }

  for (const [id, previousAgent] of previousRunningAgentsById) {
    const key = subagentReceiptKey(id);
    if (alreadyReceiptedKeys.has(key)) {
      continue;
    }
    const currentAgent = currentAgentsById.get(id);
    if (currentAgent && currentAgent.status.status === "running") {
      continue;
    }
    // Prefer the current (final-status) snapshot when the roster still holds it
    // for one tick; otherwise the last-seen running snapshot is all that exists.
    const finished = currentAgent ?? previousAgent;
    receipts.push({
      kind: "subagent",
      key,
      subagentId: id,
      title: subagentDisplayTitle(finished),
      outcome: finished.status.status === "failed" ? "failed" : "completed",
      atMs: nowMs,
      anchorTurnId,
    });
  }

  return receipts;
}
