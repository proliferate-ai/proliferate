/**
 * CLOUD-PROVISION-1 — authorization binds exactly one candidate sandbox
 * (tier-3-scenario-contract.md "Managed-Cloud World").
 *
 * The vertical slice this workstream owns:
 *   fresh disposable actor
 *   -> a repo action returns github_app_authorization_required (starts unbound)
 *   -> the REAL GitHub authorization tail through the product path
 *   -> assert EXACTLY ONE personal sandbox created via the real provisioning
 *      path (never seeded directly), stable across replay/concurrent callbacks
 *   -> candidate template identity verified (immutable, == the world handle)
 *   -> Worker/Supervisor/AnyHarness readiness
 *   -> repository materialized through the Worker credential path
 *   -> one cheap real turn
 *   -> cleanup (sandbox killed, actor ledgered).
 *
 * The product path is driven through an injected `CloudProvisionDriver` seam so
 * the orchestration/assertion logic is unit-testable with fakes AND wired to
 * the real product for a live run. Every external resource is registered in the
 * cleanup ledger IMMEDIATELY on creation, before first use.
 *
 * Assertions are strict: where the current product cannot satisfy a contract
 * step (e.g. it exposes only a rolling template ref, or Supervisor is not the
 * active parent, or the cloud turn path is not wired), the step fails RED with
 * preserved evidence — never converted to skip/expected-fail/green.
 */

import type { CleanupExecutor, CleanupLedger } from "../../contracts/cleanup.js";
import type { EvidenceSink } from "../../contracts/evidence.js";
import type { ManagedCloudWorldHandle } from "../../contracts/world.js";
import { isImmutableTemplateRef } from "./template-identity.js";
import { assertExactlyOne, reconcileCleanup } from "./guards.js";
import { redactSecrets } from "./redaction.js";

export interface CloudProvisionActor {
  readonly email: string;
  readonly userId: string;
  /** Removes the actor's org membership. Best-effort teardown. */
  teardown(): Promise<void>;
}

export interface AuthorizationTailResult {
  /** True when no personal sandbox existed before the callback fired. */
  readonly preExistingSandbox: boolean;
  /** True when this authorization callback kicked off sandbox creation. */
  readonly sandboxKickedOffByTrigger: boolean;
  /** The seeded authorization proved it can list real repos / mint an install token. */
  readonly authorizationReady: boolean;
}

export interface PersonalSandboxView {
  readonly id: string;
  readonly ownerUserId: string;
  readonly status: string;
  /** Template ref the product exposes for this sandbox (currently rolling). */
  readonly e2bTemplateRef: string;
}

export interface RuntimeReadiness {
  readonly anyharnessReady: boolean;
  readonly agentCount: number;
  /** True when the Worker is enrolled and reporting for this sandbox. */
  readonly workerEnrolled: boolean;
  /**
   * True only when Supervisor is the active parent of Worker + AnyHarness.
   * The contract requires this; if the product cannot report it, it is false
   * and the step fails red.
   */
  readonly supervisorActiveParent: boolean;
  readonly detail: string;
}

export interface RepoMaterialization {
  readonly cloned: boolean;
  readonly defaultBranch: string | null;
  /** True when the remote URL is free of any embedded token. */
  readonly remoteUrlSecretFree: boolean;
  readonly detail: string;
}

export interface TurnOutcome {
  readonly completed: boolean;
  readonly assistantReplyNonEmpty: boolean;
  readonly errorEvent: string | null;
  readonly detail: string;
}

export interface CloudProvisionDriver {
  /** Mint a fresh, disposable actor through the real invite+register path. */
  mintActor(): Promise<CloudProvisionActor>;
  /** A repo action for an unauthorized actor must return github_app_authorization_required. */
  attemptGatedRepoAction(actor: CloudProvisionActor): Promise<{ gated: boolean; code: string | null }>;
  /** Run the real GitHub authorization tail + product provisioning for the actor. */
  runAuthorizationTail(actor: CloudProvisionActor): Promise<AuthorizationTailResult>;
  /** Read the actor's single personal sandbox through the product API. */
  readPersonalSandbox(actor: CloudProvisionActor): Promise<PersonalSandboxView | null>;
  /** Probe Worker/Supervisor/AnyHarness readiness for the actor's sandbox. */
  probeRuntimeReadiness(actor: CloudProvisionActor): Promise<RuntimeReadiness>;
  /** Materialize the covered repository through the Worker credential path. */
  materializeRepository(actor: CloudProvisionActor, repo: string): Promise<RepoMaterialization>;
  /** Complete one cheap real turn in the cloud sandbox. */
  runCheapTurn(actor: CloudProvisionActor, repo: string): Promise<TurnOutcome>;
  /** Kill the actor's sandbox. */
  teardownSandbox(actor: CloudProvisionActor): Promise<void>;
}

export class CloudProvisionBlockedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "CloudProvisionBlockedError";
  }
}

export interface StepResult {
  readonly step: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface CloudProvision1Report {
  readonly scenarioId: "CLOUD-PROVISION-1";
  readonly steps: readonly StepResult[];
  readonly green: boolean;
  readonly cleanupComplete: boolean;
}

export class CloudProvision1FailedError extends Error {
  readonly report: CloudProvision1Report;
  constructor(report: CloudProvision1Report) {
    const failed = report.steps.filter((s) => !s.ok).map((s) => `${s.step}: ${s.detail}`);
    super(`CLOUD-PROVISION-1 failed:\n  ${failed.join("\n  ")}`);
    this.name = "CloudProvision1FailedError";
    this.report = report;
  }
}

export interface RunCloudProvision1Options {
  readonly handle: ManagedCloudWorldHandle;
  readonly driver: CloudProvisionDriver;
  readonly ledger: CleanupLedger;
  readonly evidence: EvidenceSink;
  readonly repository: string;
  /** Secret values for the redaction boundary — never persisted. */
  readonly secretValues?: readonly (string | undefined)[];
}

/**
 * Runs the CLOUD-PROVISION-1 vertical slice. Throws CloudProvisionBlockedError
 * when a precondition capability is absent (non-qualifying, honest), and
 * CloudProvision1FailedError when any required assertion is red. Returns a
 * green report only when every required step passed and cleanup reconciled.
 */
export async function runCloudProvision1(options: RunCloudProvision1Options): Promise<CloudProvision1Report> {
  const { handle, driver, ledger, evidence, repository } = options;
  const secrets = options.secretValues ?? [];
  const steps: StepResult[] = [];
  const cleanupExecutors = new Map<number, CleanupExecutor>();

  const record = async (step: string, ok: boolean, detail: string): Promise<StepResult> => {
    const result: StepResult = { step, ok, detail: redactSecrets(detail, { secrets }) };
    steps.push(result);
    await evidence.append({
      kind: "cloud-provision-1-step",
      scenarioId: "CLOUD-PROVISION-1",
      runId: handle.run.runId,
      shardId: handle.shard.shardId,
      step,
      ok,
      detail: result.detail,
    });
    return result;
  };

  // Precondition: the world handle must advertise an immutable template and the
  // GitHub App authority. A missing authority is blocked (cannot exercise the
  // real authorization tail), not a silent pass.
  if (!isImmutableTemplateRef(handle.template.templateId)) {
    throw new CloudProvisionBlockedError(
      `world handle template ${handle.template.templateId} is not immutable; the provisioner must pin one before this slice runs`,
    );
  }
  if (!handle.verifiedCapabilities.includes("github-app")) {
    throw new CloudProvisionBlockedError(
      "GitHub App authority is not verified in the world handle; CLOUD-PROVISION-1 cannot exercise the real " +
        "authorization tail. Configure the qualification GitHub App seed + a reachable candidate API.",
    );
  }

  let cleanupComplete = false;
  try {
    // Fresh disposable actor.
    const boundActor = await driver.mintActor();
    const membershipSeq = await ledger.register({
      runId: handle.run.runId,
      shardId: handle.shard.shardId,
      provider: "github",
      resourceType: "org-membership",
      resourceId: boundActor.userId,
      owningWorld: "managed-cloud",
    });
    cleanupExecutors.set(membershipSeq, async () => boundActor.teardown());
    await record("mint-fresh-actor", true, `minted disposable actor ${boundActor.email}`);

    // Unauthorized actor must be gated.
    const gate = await driver.attemptGatedRepoAction(boundActor);
    await record(
      "unauthorized-repo-action-gated",
      gate.gated && gate.code === "github_app_authorization_required",
      gate.gated
        ? `repo action correctly gated (${gate.code})`
        : "repo action was NOT gated for an unauthorized actor — authorization is not load-bearing",
    );

    // Real authorization tail (also kicks off provisioning). Register the
    // sandbox in the ledger immediately, before we read/use it.
    const sandboxSeq = await ledger.register({
      runId: handle.run.runId,
      shardId: handle.shard.shardId,
      provider: "e2b",
      resourceType: "personal-sandbox",
      resourceId: `actor:${boundActor.userId}`,
      owningWorld: "managed-cloud",
    });
    cleanupExecutors.set(sandboxSeq, async () => driver.teardownSandbox(boundActor));

    const tail = await driver.runAuthorizationTail(boundActor);
    await record(
      "real-authorization-tail",
      tail.authorizationReady && tail.preExistingSandbox === false && tail.sandboxKickedOffByTrigger,
      `authorizationReady=${tail.authorizationReady} preExistingSandbox=${tail.preExistingSandbox} ` +
        `kickedOff=${tail.sandboxKickedOffByTrigger}`,
    );

    // Exactly one sandbox, owned by A, stable across a replayed callback. A
    // replay that produced a different sandbox id (or a second sandbox) is a
    // hard failure — the exactly-one guard enforces this.
    const first = await driver.readPersonalSandbox(boundActor);
    const replay = await driver.runAuthorizationTail(boundActor);
    const afterReplay = await driver.readPersonalSandbox(boundActor);
    let exactlyOneOk = false;
    let exactlyOneDetail: string;
    try {
      const distinctSandboxes = new Set([first?.id, afterReplay?.id].filter((id): id is string => Boolean(id)));
      assertExactlyOne("personal-sandbox", distinctSandboxes.size);
      exactlyOneOk =
        first !== null &&
        first.ownerUserId === boundActor.userId &&
        replay.preExistingSandbox === true;
      exactlyOneDetail = `sandbox ${first?.id} owned by ${first?.ownerUserId}; replay saw preExistingSandbox=${replay.preExistingSandbox} (idempotent)`;
    } catch (error) {
      exactlyOneDetail = error instanceof Error ? error.message : String(error);
    }
    await record("exactly-one-sandbox", exactlyOneOk, exactlyOneDetail);

    // Candidate template identity: the sandbox must be bound to the immutable
    // world-handle template. (Current product exposes a rolling ref — red here.)
    const sandbox = afterReplay ?? first;
    const templateOk =
      sandbox !== null &&
      isImmutableTemplateRef(sandbox.e2bTemplateRef) &&
      sandbox.e2bTemplateRef === handle.template.templateId;
    await record(
      "candidate-template-identity",
      templateOk,
      sandbox === null
        ? "no sandbox to verify template identity against"
        : `sandbox e2bTemplateRef="${sandbox.e2bTemplateRef}" vs required immutable "${handle.template.templateId}" ` +
            (isImmutableTemplateRef(sandbox.e2bTemplateRef) ? "" : "(product exposes a ROLLING ref, not an immutable build id)"),
    );

    // Worker/Supervisor/AnyHarness readiness.
    const readiness = await driver.probeRuntimeReadiness(boundActor);
    await record(
      "worker-supervisor-anyharness-readiness",
      readiness.anyharnessReady && readiness.agentCount > 0 && readiness.workerEnrolled && readiness.supervisorActiveParent,
      `anyharnessReady=${readiness.anyharnessReady} agents=${readiness.agentCount} workerEnrolled=${readiness.workerEnrolled} ` +
        `supervisorActiveParent=${readiness.supervisorActiveParent} — ${readiness.detail}`,
    );

    // Repository materialized through the Worker credential path.
    const materialization = await driver.materializeRepository(boundActor, repository);
    await record(
      "repository-materialized-via-worker",
      materialization.cloned && materialization.remoteUrlSecretFree,
      `cloned=${materialization.cloned} branch=${materialization.defaultBranch} secretFreeRemote=${materialization.remoteUrlSecretFree} — ${materialization.detail}`,
    );

    // One cheap real turn.
    const turn = await driver.runCheapTurn(boundActor, repository);
    await record(
      "one-cheap-real-turn",
      turn.completed && turn.assistantReplyNonEmpty && turn.errorEvent === null,
      `completed=${turn.completed} replyNonEmpty=${turn.assistantReplyNonEmpty} error=${turn.errorEvent ?? "none"} — ${turn.detail}`,
    );
  } finally {
    // Cleanup: reverse order, aggregate failures, mark absent idempotently.
    const reconciliation = await reconcileCleanup(ledger, cleanupExecutors, {
      isAbsent: (e) => /not found|404|already/i.test(String(e)),
    });
    cleanupComplete = reconciliation.complete;
    await evidence.append({
      kind: "cloud-provision-1-cleanup",
      runId: handle.run.runId,
      shardId: handle.shard.shardId,
      attempted: reconciliation.attempted,
      cleaned: reconciliation.cleaned,
      alreadyAbsent: reconciliation.alreadyAbsent,
      failed: reconciliation.failed.map((f) => ({ provider: f.provider, resourceType: f.resourceType, resourceId: f.resourceId, error: f.lastError })),
      complete: reconciliation.complete,
    });
  }

  const green = steps.every((s) => s.ok) && cleanupComplete;
  const report: CloudProvision1Report = {
    scenarioId: "CLOUD-PROVISION-1",
    steps,
    green,
    cleanupComplete,
  };
  if (!green) {
    throw new CloudProvision1FailedError(report);
  }
  return report;
}
