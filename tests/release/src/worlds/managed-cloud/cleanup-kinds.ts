import { randomUUID } from "node:crypto";

import { hashLedgerId, type CleanupLedger, type CleanupResourceKind } from "../local-workspace/cleanup-ledger.js";

/**
 * The managed-cloud world's cleanup surface (spec "close() tears down in
 * reverse ledger order"). It reuses the shared durable ledger primitives
 * (`openCleanupLedger` / `CleanupLedger` / `replayLedger` /
 * `recoverInterruptedRuns` in worlds/local-workspace/cleanup-ledger.ts —
 * kind-parameterized and world-agnostic) and the six cloud kinds appended to
 * the shared `CleanupResourceKind` union, but owns its OWN evidence-category
 * mapping and cleanup stack because the cloud cleanup block is a different shape
 * from the local one (no shared behavior-changing refactor of local-workspace/
 * — that would need integrator sign-off per the extension contract).
 *
 * Deletion order (registered last → released first): E2B sandboxes → E2B
 * template → Route53 record → EC2 instance / security group / key pair →
 * LiteLLM subjects → browser → local dirs. LiteLLM subjects are released before
 * any local database teardown so the deterministic alias stays recoverable
 * (reused from PR 1 semantics). Cleanup failures are non-green; the ledger
 * survives cleanup failure.
 */

/**
 * The cloud kinds this world registers. A subset of the shared
 * `CleanupResourceKind` union (the six appended cloud kinds plus the reused
 * kinds the cloud world also creates: LiteLLM subjects, the browser, the secret
 * env file, the run directory, and the port/subdomain reservation).
 */
export const MANAGED_CLOUD_CLEANUP_KINDS = [
  "e2b_sandbox",
  "e2b_template",
  "route53_record",
  "ec2_instance",
  "security_group",
  "key_pair",
  "litellm_virtual_key",
  "litellm_user",
  "litellm_team",
  "renderer_process",
  "browser",
  "browser_context",
  "secret_env_file",
  "run_directory",
  "port_registration",
  // ── Appended for PR 6 (shared fixture layer). Only registered when a PR-6
  // fixture / deploy option is actually used; absent otherwise (behavior with
  // the fixtures unused is byte-identical). ────────────────────────────────
  "billing_fixture_adjustment",
  "callback_relay_spool",
  "callback_relay_process",
  "stripe_test_clock",
  "stripe_customer",
  // ── Appended for MANAGED-CLOUD-FIXTURE-SMOKE-1 (shared fixture live smoke).
  // Only registered when that scenario runs; folded into the
  // `stripeFixturesDeleted` evidence category below. ──────────────────────────
  "stripe_webhook_endpoint",
  "stripe_product_price",
] as const satisfies readonly CleanupResourceKind[];

export type ManagedCloudCleanupKind = (typeof MANAGED_CLOUD_CLEANUP_KINDS)[number];

/**
 * The bounded, evidence-safe summary `ManagedCloudWorld.close()` returns. Its
 * shape mirrors the `cleanup` block of `CloudProvisionTurnEvidenceV1`
 * (evidence/schema.ts) in camelCase: a green cell requires `failed === 0` and
 * every deletion boolean true.
 */
export interface ManagedCloudCleanupEvidence {
  ledgerIdHash: string;
  registered: number;
  reconciled: number;
  failed: number;
  sandboxesDeleted: boolean;
  templateDeleted: boolean;
  dnsRecordDeleted: boolean;
  ec2Terminated: boolean;
  securityGroupDeleted: boolean;
  keyPairDeleted: boolean;
  virtualKeyDeleted: boolean;
  litellmSubjectsDeleted: boolean;
  localPathsRemoved: boolean;
  // ── Appended for PR 6 (shared fixture layer). OPTIONAL so every existing
  // constructor of this evidence shape (e.g. CLOUD-PROVISION-1's fake driver)
  // stays valid unchanged — `runAll` always populates them, but a caller that
  // fabricates a summary need not. Each category is vacuously clean (true) on a
  // run that registers no entry of its kind(s), so a run that uses none of the
  // PR-6 fixtures reports these `true` exactly as an untouched category always
  // has (see `categoryClean`). CLOUD-PROVISION-1's evidence mapping ignores
  // these fields, so the regression is unchanged. ────────────────────────────
  /** The run-tagged billingThreshold grant adjustment was expired/deleted. */
  billingFixtureCleared?: boolean;
  /** The on-box signed-callback relay spool + process were cleared/stopped. */
  relayStopped?: boolean;
  /** The Stripe TEST-mode test clock + customer(s) were deleted. */
  stripeFixturesDeleted?: boolean;
}

/**
 * Evidence-boolean categories → the cloud resource kinds that satisfy them.
 * Every category with ≥1 registered entry must have all its entries reconciled
 * for its boolean to be true (so an incomplete/failed run cannot show a
 * fully-clean summary). Mirrors the local world's `EVIDENCE_CATEGORIES`.
 */
export const MANAGED_CLOUD_EVIDENCE_CATEGORIES = {
  sandboxesDeleted: ["e2b_sandbox"],
  templateDeleted: ["e2b_template"],
  dnsRecordDeleted: ["route53_record"],
  ec2Terminated: ["ec2_instance"],
  securityGroupDeleted: ["security_group"],
  keyPairDeleted: ["key_pair"],
  virtualKeyDeleted: ["litellm_virtual_key"],
  litellmSubjectsDeleted: ["litellm_user", "litellm_team"],
  localPathsRemoved: ["secret_env_file", "run_directory", "port_registration"],
  // ── Appended for PR 6 (shared fixture layer). ──────────────────────────────
  billingFixtureCleared: ["billing_fixture_adjustment"],
  relayStopped: ["callback_relay_spool", "callback_relay_process"],
  // MANAGED-CLOUD-FIXTURE-SMOKE-1 folds its run-scoped Stripe webhook endpoint
  // and product+price into the same stripeFixturesDeleted category as the test
  // clock + customer, so one boolean covers "every run-owned Stripe resource
  // deleted/deactivated".
  stripeFixturesDeleted: [
    "stripe_test_clock",
    "stripe_customer",
    "stripe_webhook_endpoint",
    "stripe_product_price",
  ],
} satisfies Record<string, CleanupResourceKind[]>;

/** One registered releaser plus the ledger entry that shadows it durably. */
interface ManagedCloudCleanupRegistration {
  entryId: string;
  kind: ManagedCloudCleanupKind;
  release: () => Promise<void>;
}

export interface ManagedCloudCleanupStackOptions {
  ledger: CleanupLedger;
  log?: (message: string) => void;
}

/**
 * Accumulates reverse-order releasers backed by the durable ledger, like the
 * local world's stack, but returns the cloud evidence summary. The world
 * constructor calls `register` (writes intent), creates the resource, then
 * `acquired` (writes the safe provider id). `runAll` releases in reverse and
 * returns the evidence summary; the `run_directory` releaser is skipped when an
 * earlier releaser failed so the ledger survives for replay (PR 1 semantics).
 */
export class ManagedCloudCleanupStack {
  private readonly ledger: CleanupLedger;
  private readonly log: (message: string) => void;
  private readonly registrations: ManagedCloudCleanupRegistration[] = [];

  constructor(options: ManagedCloudCleanupStackOptions) {
    this.ledger = options.ledger;
    this.log = options.log ?? (() => undefined);
  }

  /** Writes an `intent` ledger record and returns the entry id to acquire. */
  async register(kind: ManagedCloudCleanupKind, release: () => Promise<void>): Promise<string> {
    const entryId = randomUUID();
    await this.ledger.registerIntent(kind, entryId);
    this.registrations.push({ entryId, kind, release });
    return entryId;
  }

  /** Marks a registered resource acquired with its safe provider identity. */
  async acquired(entryId: string, providerId: string): Promise<void> {
    await this.ledger.markAcquired(entryId, providerId);
  }

  /**
   * Releases every acquired resource in reverse registration order, marking
   * each reconciled, and returns the bounded evidence summary. Never throws for
   * an individual failure — it counts them; the caller decides the verdict.
   */
  async runAll(): Promise<ManagedCloudCleanupEvidence> {
    const succeeded = new Set<string>();
    let failed = 0;
    for (const registration of [...this.registrations].reverse()) {
      // The `run_directory` releaser deletes the run directory — which holds
      // this very ledger — so it must never run while any earlier (reverse
      // order) releaser this pass has failed. Deleting the directory anyway
      // would destroy the only durable record of the unreconciled entry,
      // leaving replay-by-run nothing to replay. Preserve the directory and
      // record the skip as a failure instead; a later replay/recovery pass
      // still has the ledger to work from.
      if (registration.kind === "run_directory" && failed > 0) {
        failed += 1;
        this.log(
          `cleanup releaser for run_directory skipped: ${failed - 1} earlier releaser(s) failed this run; ` +
            `preserving the run directory and cleanup ledger for replay-by-run`,
        );
        continue;
      }
      try {
        await registration.release();
        succeeded.add(registration.entryId);
        // The resource is gone; persisting the reconcile is best-effort — the
        // `run_directory` releaser deletes the ledger file itself, so a failed
        // write here must not count the successful release as a failure.
        await this.ledger.markReconciled(registration.entryId).catch(() => undefined);
      } catch (error) {
        failed += 1;
        this.log(
          `cleanup releaser for ${registration.kind} failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return {
      ledgerIdHash: hashLedgerId(this.ledger.ledgerId),
      registered: this.registrations.length,
      reconciled: succeeded.size,
      failed,
      sandboxesDeleted: this.categoryClean("sandboxesDeleted", succeeded),
      templateDeleted: this.categoryClean("templateDeleted", succeeded),
      dnsRecordDeleted: this.categoryClean("dnsRecordDeleted", succeeded),
      ec2Terminated: this.categoryClean("ec2Terminated", succeeded),
      securityGroupDeleted: this.categoryClean("securityGroupDeleted", succeeded),
      keyPairDeleted: this.categoryClean("keyPairDeleted", succeeded),
      virtualKeyDeleted: this.categoryClean("virtualKeyDeleted", succeeded),
      litellmSubjectsDeleted: this.categoryClean("litellmSubjectsDeleted", succeeded),
      localPathsRemoved: this.categoryClean("localPathsRemoved", succeeded),
      billingFixtureCleared: this.categoryClean("billingFixtureCleared", succeeded),
      relayStopped: this.categoryClean("relayStopped", succeeded),
      stripeFixturesDeleted: this.categoryClean("stripeFixturesDeleted", succeeded),
    };
  }

  private categoryClean(
    category: keyof typeof MANAGED_CLOUD_EVIDENCE_CATEGORIES,
    succeeded: ReadonlySet<string>,
  ): boolean {
    const kinds = new Set<CleanupResourceKind>(MANAGED_CLOUD_EVIDENCE_CATEGORIES[category]);
    const inCategory = this.registrations.filter((registration) => kinds.has(registration.kind));
    if (inCategory.length === 0) {
      // No registrations in this category: vacuously clean. A zero-registration
      // category must not read as a failure (that would produce contradictory
      // evidence like `failed: 0` alongside a false deletion boolean).
      return true;
    }
    return inCategory.every((registration) => succeeded.has(registration.entryId));
  }
}
