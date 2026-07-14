import { randomUUID } from "node:crypto";

import { hashLedgerId, type CleanupLedger, type CleanupResourceKind } from "./cleanup-ledger.js";

/**
 * The real local-world cleanup stack (spec "Cleanup and failure behavior").
 * Each resource registers a reverse-order releaser as it is created and every
 * registration is first written to the durable ledger. The stack runs in
 * `finally`, including after readiness or scenario failure, and is idempotent.
 *
 * Deletion order matters: the external LiteLLM virtual key/team/user are
 * deleted BEFORE local database teardown so the deterministic alias stays
 * recoverable. Cleanup is deliberately concrete to this consumer, not a generic
 * framework.
 */

/**
 * The bounded, evidence-safe summary `ReadyLocalWorld.close()` returns. Its
 * shape is exactly the `cleanup` block of `LocalWorkspaceTurnEvidenceV1`
 * (evidence/schema.ts): a green cell requires `failed === 0` and every deletion
 * boolean true.
 */
export interface LocalWorldCleanupEvidence {
  ledgerIdHash: string;
  registered: number;
  reconciled: number;
  failed: number;
  virtualKeyDeleted: boolean;
  litellmSubjectsDeleted: boolean;
  browserClosed: boolean;
  processesStopped: boolean;
  containersRemoved: boolean;
  localPathsRemoved: boolean;
}

/** One registered releaser plus the ledger entry that shadows it durably. */
export interface CleanupRegistration {
  entryId: string;
  kind: CleanupResourceKind;
  release: () => Promise<void>;
}

export interface CleanupStackOptions {
  ledger: CleanupLedger;
  log?: (message: string) => void;
}

/**
 * Accumulates reverse-order releasers backed by the durable ledger. The world
 * constructor calls `register` (writes intent), then creates the resource, then
 * `acquired` (writes the safe provider id). `runAll` releases in reverse and
 * returns the evidence summary.
 */
/** Evidence-boolean categories → the resource kinds that satisfy them. Every
 * category must have ≥1 registered entry, all reconciled, for its boolean to be
 * true (so an incomplete/failed run cannot show a fully-clean summary). */
const EVIDENCE_CATEGORIES = {
  virtualKeyDeleted: ["litellm_virtual_key"],
  litellmSubjectsDeleted: ["litellm_user", "litellm_team"],
  browserClosed: ["browser", "browser_context"],
  processesStopped: ["renderer_process", "anyharness_process"],
  containersRemoved: ["server_container", "postgres_container", "redis_container", "docker_network"],
  localPathsRemoved: [
    "runtime_home",
    "repository_clone",
    "extracted_artifacts",
    "run_directory",
    "port_registration",
  ],
} satisfies Record<string, CleanupResourceKind[]>;

export class LocalWorldCleanupStack {
  private readonly ledger: CleanupLedger;
  private readonly log: (message: string) => void;
  private readonly registrations: CleanupRegistration[] = [];

  constructor(options: CleanupStackOptions) {
    this.ledger = options.ledger;
    this.log = options.log ?? (() => undefined);
  }

  /** Writes an `intent` ledger record and returns the entry id to acquire. */
  async register(kind: CleanupResourceKind, release: () => Promise<void>): Promise<string> {
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
  async runAll(): Promise<LocalWorldCleanupEvidence> {
    const succeeded = new Set<string>();
    let failed = 0;
    for (const registration of [...this.registrations].reverse()) {
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
      virtualKeyDeleted: this.categoryClean("virtualKeyDeleted", succeeded),
      litellmSubjectsDeleted: this.categoryClean("litellmSubjectsDeleted", succeeded),
      browserClosed: this.categoryClean("browserClosed", succeeded),
      processesStopped: this.categoryClean("processesStopped", succeeded),
      containersRemoved: this.categoryClean("containersRemoved", succeeded),
      localPathsRemoved: this.categoryClean("localPathsRemoved", succeeded),
    };
  }

  private categoryClean(
    category: keyof typeof EVIDENCE_CATEGORIES,
    succeeded: ReadonlySet<string>,
  ): boolean {
    const kinds = new Set<CleanupResourceKind>(EVIDENCE_CATEGORIES[category]);
    const inCategory = this.registrations.filter((registration) => kinds.has(registration.kind));
    if (inCategory.length === 0) {
      return false;
    }
    return inCategory.every((registration) => succeeded.has(registration.entryId));
  }
}
