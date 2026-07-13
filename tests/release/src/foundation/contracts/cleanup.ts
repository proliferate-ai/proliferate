/**
 * Persistent cleanup ledger.
 *
 * Every external resource is appended to durable run output immediately after
 * creation and before it is handed to another operation. Entries carry only
 * safe identity — credentials and arbitrary provider payloads are forbidden.
 * Cleanup runs in reverse registration order, continues through independent
 * failures, persists every transition atomically, and can be replayed after a
 * crash. Later janitor success never turns a strict run with failed cleanup
 * green.
 */

export type CleanupState =
  | "registered"
  | "cleaning"
  | "cleaned"
  | "failed"
  /** Resource observed already gone; idempotent replay success. */
  | "absent";

export interface CleanupEntry {
  /** Monotonic registration sequence within the run. */
  readonly sequence: number;
  readonly runId: string;
  readonly shardId: string;
  /** e.g. "e2b", "stripe", "litellm", "aws-ec2", "github", "local-process". */
  readonly provider: string;
  /** e.g. "sandbox", "customer", "virtual-key", "instance", "repository-grant". */
  readonly resourceType: string;
  /** Safe provider-side identifier — never a credential. */
  readonly resourceId: string;
  readonly owningWorld: string;
  readonly state: CleanupState;
  readonly attempts: number;
  readonly registeredAt: string;
  readonly updatedAt: string;
  /** Sanitized failure detail when state is "failed". */
  readonly lastError: string | null;
}

export interface CleanupLedger {
  /**
   * Persists the entry durably before returning. The returned sequence is the
   * handle used for state transitions.
   */
  register(
    entry: Omit<CleanupEntry, "sequence" | "state" | "attempts" | "registeredAt" | "updatedAt" | "lastError">,
  ): Promise<number>;
  transition(sequence: number, state: CleanupState, error?: string): Promise<void>;
  entries(): Promise<readonly CleanupEntry[]>;
}

/** A provider-specific destructor, registered alongside the entry. */
export type CleanupExecutor = (entry: CleanupEntry) => Promise<void>;

export interface CleanupReconciliation {
  readonly attempted: number;
  readonly cleaned: number;
  readonly alreadyAbsent: number;
  readonly failed: readonly CleanupEntry[];
  /** True only when no entry remains in registered/cleaning/failed state. */
  readonly complete: boolean;
}
