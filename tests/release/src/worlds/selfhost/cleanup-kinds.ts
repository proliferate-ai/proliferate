import { randomUUID } from "node:crypto";

import {
  hashLedgerId,
  type CleanupLedger,
  type CleanupResourceKind,
} from "../local-workspace/cleanup-ledger.js";

/**
 * The self-host world's cleanup categorization (frozen spec "World construction"
 * step 7 + "Failure semantics"). The four new AWS resource kinds
 * (`ec2_instance`, `security_group`, `key_pair`, `route53_record`) are appended
 * to the shared `CleanupResourceKind` union in
 * `../local-workspace/cleanup-ledger.ts` (append-only; the extension contract
 * forbids restructuring). This module owns the SELF-HOST-specific slice of that
 * union and a self-host cleanup stack whose evidence categories differ from the
 * local world's (no LiteLLM/containers; EC2/DNS/SG/key-pair instead). It reuses
 * the durable `CleanupLedger` and its registered-before-create / reverse-order
 * semantics unchanged — it does NOT fork the ledger.
 */

/** The subset of the shared union the self-host world registers. */
export type SelfHostCleanupResourceKind = Extract<
  CleanupResourceKind,
  | "ec2_instance"
  | "security_group"
  | "key_pair"
  | "route53_record"
  | "anyharness_process"
  | "renderer_process"
  | "browser"
  | "browser_context"
  | "runtime_home"
  | "secret_env_file"
  | "extracted_artifacts"
  | "run_directory"
  | "port_registration"
  // SH-CLOUD-ADDON only (SELFHOST-QUAL-1): when the cloud add-on is enabled on a
  // self-host box it provisions a personal E2B sandbox from a self-built E2B
  // template — SEPARATE-account resources that survive the EC2 box's teardown, so
  // they must be reaped through this same durable, reverse-order, replay-by-run
  // ledger (SHR-006), not a cell-local finally. They are DELIBERATELY absent from
  // `SELFHOST_EVIDENCE_CATEGORIES` below: those categories are the green-gating
  // deletion booleans every self-host scenario shares, and a category requiring
  // ≥1 registration would make INSTALL-1/ISOLATION-1/CFN-1 (which never touch
  // E2B) look dirty. E2B reap therefore folds into the generic
  // `registered`/`reconciled`/`failed` counts (a failed reap makes `failed > 0`,
  // which downgrades the cell) plus the cell's own `disable_truthful` evidence —
  // no new named cleanup boolean, no sibling-scenario blast radius.
  | "e2b_sandbox"
  | "e2b_template"
>;

/**
 * The bounded, evidence-safe summary `ReadySelfHostWorld.close()` returns. Its
 * shape is exactly the `cleanup` block of the self-host evidence kinds
 * (`SelfHostCleanupEvidenceBlock` in evidence/schema.ts): a green cell requires
 * `failed === 0` and every deletion boolean true.
 */
export interface SelfHostWorldCleanupEvidence {
  ledgerIdHash: string;
  registered: number;
  reconciled: number;
  failed: number;
  ec2Terminated: boolean;
  securityGroupDeleted: boolean;
  keyPairDeleted: boolean;
  route53RecordDeleted: boolean;
  browserClosed: boolean;
  processesStopped: boolean;
  localPathsRemoved: boolean;
}

/**
 * Evidence-boolean categories → the resource kinds that satisfy them. Every
 * category must have ≥1 registered entry, all reconciled, for its boolean to be
 * true — so an incomplete/failed run cannot show a fully-clean summary (mirrors
 * the local world's `EVIDENCE_CATEGORIES` discipline).
 */
export const SELFHOST_EVIDENCE_CATEGORIES = {
  ec2Terminated: ["ec2_instance"],
  securityGroupDeleted: ["security_group"],
  keyPairDeleted: ["key_pair"],
  route53RecordDeleted: ["route53_record"],
  browserClosed: ["browser", "browser_context"],
  processesStopped: ["anyharness_process", "renderer_process"],
  localPathsRemoved: [
    "runtime_home",
    "secret_env_file",
    "extracted_artifacts",
    "run_directory",
    "port_registration",
  ],
} satisfies Record<string, SelfHostCleanupResourceKind[]>;

export interface SelfHostCleanupStackOptions {
  ledger: CleanupLedger;
  log?: (message: string) => void;
}

/** One registered releaser plus the ledger entry that shadows it durably. */
interface SelfHostCleanupRegistration {
  entryId: string;
  kind: SelfHostCleanupResourceKind;
  release: () => Promise<void>;
}

/**
 * Accumulates reverse-order releasers backed by the durable ledger. Deletion
 * order matters: AWS resources are deleted after the controller-local
 * processes/browser and before the local run directory. Like the local stack,
 * `runAll` never throws for an individual failure — it counts them; the caller
 * decides the verdict, and the `run_directory` releaser is preserved when any
 * earlier releaser failed so replay-by-run still has the ledger.
 */
export class SelfHostCleanupStack {
  private readonly ledger: CleanupLedger;
  private readonly log: (message: string) => void;
  private readonly registrations: SelfHostCleanupRegistration[] = [];

  constructor(options: SelfHostCleanupStackOptions) {
    this.ledger = options.ledger;
    this.log = options.log ?? (() => undefined);
  }

  /** Writes an `intent` ledger record and returns the entry id to acquire. */
  async register(kind: SelfHostCleanupResourceKind, release: () => Promise<void>): Promise<string> {
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
   * Releases every acquired resource in reverse registration order, marking each
   * reconciled, and returns the bounded evidence summary. Never throws for an
   * individual failure — it counts them; the caller decides the verdict.
   */
  async runAll(): Promise<SelfHostWorldCleanupEvidence> {
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
      ec2Terminated: this.categoryClean("ec2Terminated", succeeded),
      securityGroupDeleted: this.categoryClean("securityGroupDeleted", succeeded),
      keyPairDeleted: this.categoryClean("keyPairDeleted", succeeded),
      route53RecordDeleted: this.categoryClean("route53RecordDeleted", succeeded),
      browserClosed: this.categoryClean("browserClosed", succeeded),
      processesStopped: this.categoryClean("processesStopped", succeeded),
      localPathsRemoved: this.categoryClean("localPathsRemoved", succeeded),
    };
  }

  private categoryClean(
    category: keyof typeof SELFHOST_EVIDENCE_CATEGORIES,
    succeeded: ReadonlySet<string>,
  ): boolean {
    const kinds = new Set<SelfHostCleanupResourceKind>(SELFHOST_EVIDENCE_CATEGORIES[category]);
    const inCategory = this.registrations.filter((registration) => kinds.has(registration.kind));
    if (inCategory.length === 0) {
      return false;
    }
    return inCategory.every((registration) => succeeded.has(registration.entryId));
  }
}
