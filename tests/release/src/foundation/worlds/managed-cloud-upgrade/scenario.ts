/**
 * T4-RUNTIME-1 — heartbeat-driven managed-cloud runtime update, N-1 -> N.
 *
 * This is the REWRITE of legacy T4-CLOUD-1 to the intended ownership model
 * (Worker mailbox request -> Supervisor consume/verify/stage/activate/health-gate
 * -> AnyHarness installed-only reconcile), NOT a rename. The forbidden pieces of
 * the legacy scenario are gone by construction:
 *   - no global/staging RUNTIME_VERSION image-env mutation (uses the run/target
 *     -scoped desired-version channel on the handle);
 *   - no durable shared staging user (a disposable actor per run);
 *   - no hard-coded published versions (exact candidate N from the manifest);
 *   - no "only runtime /health" check (asserts the full ownership boundary and
 *     per-agent reconcile terminal state).
 *
 * The scenario drives the real product path through injected deps so the
 * orchestration is unit-testable and the ownership assertion is reproducible
 * without provisioning E2B. Against the CURRENT product (direct-Worker
 * activation, Supervisor not the parent) the ownership assertion FAILS — that
 * is the point; the failure is preserved as OwnershipAssertionError enumerating
 * the owning product changes rather than converted to a skip or a green.
 */

import type { ManagedCloudUpgradeWorldHandle } from "../../contracts/world.js";
import type { TargetScopedDesiredVersionChannel } from "./desired-version-channel.js";
import type { OwnershipViolation, UpgradeObservation } from "./ownership.js";
import { evaluateOwnership } from "./ownership.js";

/** A provisioned N-1 sandbox target the scenario drives. */
export interface ProvisionedTarget {
  readonly cloudSandboxId: string;
  /** Per-target desired-version channel bound to this sandbox. */
  readonly channel: TargetScopedDesiredVersionChannel;
}

/**
 * The real product-path operations the scenario needs. A live runner supplies
 * an implementation backed by the candidate API + GitHub authorization; tests
 * supply a scripted double. None of these fake the ownership boundary — they
 * only drive/observe the real product.
 */
export interface ManagedCloudUpgradeDeps {
  /**
   * The exact candidate-N AnyHarness version this run converges to, read from
   * the candidate manifest the deps were constructed with — never a rolling or
   * hard-coded value, and distinct from the candidate source SHA.
   */
  candidateAnyharnessVersion(): string;
  /**
   * Provision the disposable actor's sandbox through the real GitHub-authorized
   * product path against the immutable N-1 template. Registers the sandbox in
   * the cleanup ledger. Returns the target + its bound desired-version channel.
   */
  provisionN1Target(handle: ManagedCloudUpgradeWorldHandle): Promise<ProvisionedTarget>;
  /** Assert the freshly provisioned sandbox reports the retained N-1 identities. */
  verifyBaseline(target: ProvisionedTarget): Promise<void>;
  /** Create a workspace/session and complete one bounded cheap-model turn. */
  baselineTurn(target: ProvisionedTarget): Promise<void>;
  /**
   * Observe convergence after the flip: heartbeat desired version, Worker
   * mailbox request count, whether the Worker directly activated, Supervisor
   * consume/stage/activate/health-gate, AnyHarness reported version, per-agent
   * reconcile outcomes, state continuity, and the post-update turn.
   */
  observeConvergence(
    handle: ManagedCloudUpgradeWorldHandle,
    target: ProvisionedTarget,
  ): Promise<UpgradeObservation>;
}

/** Thrown when the intended ownership boundary is violated — the failing evidence. */
export class OwnershipAssertionError extends Error {
  readonly violations: readonly OwnershipViolation[];
  readonly observation: UpgradeObservation;

  constructor(violations: readonly OwnershipViolation[], observation: UpgradeObservation) {
    super(
      `T4-RUNTIME-1 ownership boundary violated (${violations.length}): ` +
        violations.map((v) => `[${v.rule}] ${v.detail}`).join(" | "),
    );
    this.name = "OwnershipAssertionError";
    this.violations = violations;
    this.observation = observation;
  }
}

export interface T4Runtime1Result {
  readonly target: ProvisionedTarget;
  readonly observation: UpgradeObservation;
}

/**
 * Run the full T4-RUNTIME-1 flow. Resolves with the observation on the intended
 * green path; throws OwnershipAssertionError (preserving the observation) when
 * the ownership boundary is not satisfied.
 */
export async function runT4Runtime1(
  handle: ManagedCloudUpgradeWorldHandle,
  deps: ManagedCloudUpgradeDeps,
): Promise<T4Runtime1Result> {
  // Baseline: provision N-1, verify identities, complete one real turn while
  // desired version is still held at N-1.
  const target = await deps.provisionN1Target(handle);
  await deps.verifyBaseline(target);
  await deps.baselineTurn(target);

  // Flip ONLY this target/run to exact candidate N. The version comes from the
  // candidate manifest, never a hard-coded or rolling value, and the channel is
  // per-sandbox — no global pin is touched.
  const candidateVersion = deps.candidateAnyharnessVersion();
  await target.channel.setAnyharnessVersion(candidateVersion);

  // Observe convergence and evaluate the intended ownership boundary.
  const observation = await deps.observeConvergence(handle, target);
  const verdict = evaluateOwnership(observation);
  if (!verdict.satisfied) {
    throw new OwnershipAssertionError(verdict.violations, observation);
  }
  return { target, observation };
}
