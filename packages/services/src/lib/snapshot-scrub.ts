/**
 * Snapshot scrub — env file scrubbing removed.
 *
 * Secrets are now user-managed env vars, not files on disk.
 * This module preserves the old types/signature for caller compatibility.
 */

export interface PrepareForSnapshotOptions {
	provider: unknown;
	sandboxId: string;
	configurationId?: string | null;
	logger?: unknown;
	logContext?: string;
	failureMode?: "throw" | "log";
	reapplyAfterCapture?: boolean;
}

export type SnapshotCleanup = () => Promise<void>;

export async function prepareForSnapshot(
	_options: PrepareForSnapshotOptions,
): Promise<SnapshotCleanup> {
	// No-op — env file scrubbing removed.
	return async () => {};
}
