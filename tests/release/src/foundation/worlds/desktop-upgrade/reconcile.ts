/**
 * Terminal, exact-set evaluation of Desktop N installed-agent reconciliation,
 * plus the bounded-turn deadline guard and the duplicate-transcript-event guard.
 *
 * These are the assertions the tier-4-scenario-contract.md "Required
 * assertions" demand and that must never be softened into a green escape:
 *
 *  - Agent reconciliation reaches TERMINAL completion with ZERO failed per-agent
 *    outcomes; top-level HTTP health alone is insufficient.
 *  - Every already-installed native CLI and ACP agent-process artifact matches
 *    its N pin and verified source. An unchanged pin is an evidenced no-op; a
 *    changed pin performs the real update.
 *  - A second reconciliation is idempotent.
 *  - The post-update turn completes without duplicated transcript events.
 *
 * Pure logic only — no network, no process. The provisioner/scenario feed it
 * observed facts.
 */

export type ReconcileTerminalState = "completed" | "failed" | "pending" | "running";
export type ReconcileAgentKind = "native-cli" | "acp-process";
export type ReconcileAction = "no-op" | "updated";

/** One per-agent reconcile cell as observed from AnyHarness after Desktop N. */
export interface PerAgentReconcileOutcome {
  readonly agent: string;
  readonly kind: ReconcileAgentKind;
  readonly terminalState: ReconcileTerminalState;
  /** Installed pin before the upgrade (N-1 world). */
  readonly pinBefore: string;
  /** Installed pin after reconcile. */
  readonly pinAfter: string;
  /** The pin N's bundled catalog/registry requires for this agent. */
  readonly expectedPin: string;
  /** Whether the artifact source was cryptographically verified during install. */
  readonly verifiedSource: boolean;
}

export interface ReconcileVerdict {
  readonly ok: boolean;
  readonly reasons: readonly string[];
  /** Agents whose pin naturally changed and were actually updated. */
  readonly updatedAgents: readonly string[];
  /** Agents whose pin was already equal — evidenced no-ops. */
  readonly noopAgents: readonly string[];
}

/**
 * Exact-set reconcile evaluation. `expectedAgents` is the full set that N's
 * bundled catalog says must be installed; the outcomes must cover exactly that
 * set — no missing agent, no unexpected agent, no duplicate — with every cell
 * terminal-completed, zero failed, matching its expected pin, and verified.
 */
export function evaluateReconcile(
  outcomes: readonly PerAgentReconcileOutcome[],
  expectedAgents: readonly string[],
): ReconcileVerdict {
  const reasons: string[] = [];
  const seen = new Map<string, number>();
  for (const o of outcomes) {
    seen.set(o.agent, (seen.get(o.agent) ?? 0) + 1);
  }

  const expectedSet = new Set(expectedAgents);
  const missing = expectedAgents.filter((a) => !seen.has(a));
  const unexpected = [...seen.keys()].filter((a) => !expectedSet.has(a));
  const duplicated = [...seen.entries()].filter(([, n]) => n > 1).map(([a]) => a);

  if (missing.length > 0) reasons.push(`missing per-agent reconcile results: ${missing.join(", ")}`);
  if (unexpected.length > 0) reasons.push(`unexpected reconcile results: ${unexpected.join(", ")}`);
  if (duplicated.length > 0) reasons.push(`duplicate reconcile results: ${duplicated.join(", ")}`);

  const updatedAgents: string[] = [];
  const noopAgents: string[] = [];
  for (const o of outcomes) {
    if (o.terminalState !== "completed") {
      reasons.push(`${o.agent}: non-terminal or failed reconcile state "${o.terminalState}"`);
      continue;
    }
    if (o.pinAfter !== o.expectedPin) {
      reasons.push(`${o.agent}: installed pin ${o.pinAfter} != N pin ${o.expectedPin}`);
    }
    if (!o.verifiedSource) {
      reasons.push(`${o.agent}: artifact source not verified`);
    }
    if (o.pinBefore === o.expectedPin) {
      // Equal pin: must be an evidenced no-op (no bytes changed).
      if (o.pinAfter !== o.pinBefore) {
        reasons.push(`${o.agent}: unchanged pin ${o.pinBefore} was mutated to ${o.pinAfter}`);
      }
      noopAgents.push(o.agent);
    } else {
      // Changed pin: a real update actually happened.
      updatedAgents.push(o.agent);
    }
  }

  return { ok: reasons.length === 0, reasons, updatedAgents, noopAgents };
}

/**
 * A second reconcile must be a pure no-op: every agent already at its N pin,
 * nothing re-downloaded or mutated. Idempotency is proven, not assumed.
 */
export function assertIdempotentReconcile(second: readonly PerAgentReconcileOutcome[]): ReconcileVerdict {
  const reasons: string[] = [];
  for (const o of second) {
    if (o.terminalState !== "completed") {
      reasons.push(`${o.agent}: second reconcile not terminal-completed (${o.terminalState})`);
    }
    if (o.pinBefore !== o.pinAfter) {
      reasons.push(`${o.agent}: second reconcile changed pin ${o.pinBefore} -> ${o.pinAfter} (not idempotent)`);
    }
    if (o.pinAfter !== o.expectedPin) {
      reasons.push(`${o.agent}: second reconcile drifted from N pin ${o.expectedPin}`);
    }
  }
  return { ok: reasons.length === 0, reasons, updatedAgents: [], noopAgents: second.map((o) => o.agent) };
}

/**
 * Duplicate transcript event guard for the post-update turn. Event ids must be
 * unique and the sequence monotonic across the relaunch — a duplicated or
 * out-of-order event fails the continuity assertion.
 */
export interface TranscriptEvent {
  readonly id: string;
  readonly sequence: number;
}

export interface TranscriptContinuityVerdict {
  readonly ok: boolean;
  readonly reasons: readonly string[];
}

export function evaluateTranscriptContinuity(
  events: readonly TranscriptEvent[],
): TranscriptContinuityVerdict {
  const reasons: string[] = [];
  const ids = new Set<string>();
  for (const e of events) {
    if (ids.has(e.id)) reasons.push(`duplicate transcript event id: ${e.id}`);
    ids.add(e.id);
  }
  for (let i = 1; i < events.length; i += 1) {
    if (events[i].sequence <= events[i - 1].sequence) {
      reasons.push(
        `non-monotonic transcript sequence: ${events[i - 1].sequence} then ${events[i].sequence}`,
      );
    }
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * Bounded-turn deadline guard. A live turn must complete before its budget; a
 * blown deadline is a real failure, never a soft pass. Returns the elapsed ms
 * on success.
 */
export async function withDeadline<T>(
  label: string,
  budgetMs: number,
  work: () => Promise<T>,
): Promise<{ value: T; elapsedMs: number }> {
  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new DeadlineExceededError(`${label} exceeded ${budgetMs}ms budget`)),
      budgetMs,
    );
  });
  try {
    const value = await Promise.race([work(), deadline]);
    return { value, elapsedMs: Date.now() - started };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class DeadlineExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeadlineExceededError";
  }
}
