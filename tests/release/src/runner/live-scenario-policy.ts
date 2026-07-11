/**
 * Live-scenario execution policy (WS10a) — correlation, deadline, and the
 * no-retry-after-external-effect invariant from
 * `specs/tbd/workflows-v1-completion-plan.md` §6 WS10:
 *
 *   "Every live scenario has a unique correlation ID, fixed deadline, maximum
 *    agent-turn/tool budget, and no test-runner retry after an external effect;
 *    infrastructure setup retries use the same idempotency identity."
 *
 * The runner drives each scenario/lane exactly once — there is no retry loop in
 * `src/cli/run.ts`. That is enforced structurally here by `ScenarioRunGuard`
 * (a second attempt at the same scenario/lane throws) and asserted by
 * workflow-policy.test.ts so a future retry loop cannot be added silently.
 */

import { randomUUID } from "node:crypto";

/**
 * Fixed per-scenario deadline. Generous enough that no currently-green live
 * scenario trips it (real cloud/desktop scenarios complete well under this),
 * but bounded so a hung scenario cannot stall a release run indefinitely.
 */
export const SCENARIO_DEADLINE_MS = 30 * 60 * 1000;

/**
 * The runner never retries a scenario after an external effect. Kept as an
 * explicit, testable constant so the invariant is documented in code and a
 * regression is caught by workflow-policy.test.ts.
 */
export const RUNNER_RETRIES_AFTER_EXTERNAL_EFFECT = false;

/** Builds a unique correlation ID for one scenario/lane run. */
export function scenarioCorrelationId(scenarioId: string, lane: string, runId: string = randomUUID()): string {
  return `${scenarioId}/${lane}/${runId}`;
}

/**
 * Runs `work` under a fixed deadline. Rejects with a deadline error if `work`
 * has not settled within `ms`. The timer is unref'd and cleared so it never
 * keeps the event loop alive or fires after settlement.
 */
export async function withDeadline<T>(
  work: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} exceeded the ${ms}ms scenario deadline`));
    }, ms);
    if (typeof timer.unref === "function") {
      timer.unref();
    }
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Structural guard against retrying a scenario/lane after it has already been
 * driven (which, after an external effect, would risk a duplicate effect). The
 * runner registers each scenario/lane exactly once; a second registration for
 * the same key throws.
 */
export class ScenarioRunGuard {
  private readonly seen = new Set<string>();

  /** Marks a scenario/lane as started. Throws on a second attempt at the same key. */
  begin(scenarioId: string, lane: string): void {
    const key = `${scenarioId}/${lane}`;
    if (this.seen.has(key)) {
      throw new Error(
        `Refusing to retry ${key}: the release runner never re-drives a scenario after it has run ` +
          "(no retry after an external effect). Fix the runner, not this guard.",
      );
    }
    this.seen.add(key);
  }
}
