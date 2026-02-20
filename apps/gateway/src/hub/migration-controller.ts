/**
 * Migration Controller
 *
 * Schedules snapshot-before-expiry and handles sandbox migration.
 */

import type { Logger } from "@proliferate/logger";
import { notifications, sessions } from "@proliferate/services";
import type { SandboxProviderType, ServerMessage } from "@proliferate/shared";
import { getSandboxProvider } from "@proliferate/shared/providers";
import { cancelSessionExpiry } from "../expiry/expiry-queue";
import type { GatewayEnv } from "../lib/env";
import { runWithMigrationLock } from "../lib/lock";
import { abortOpenCodeSession } from "../lib/opencode";
import type { EventProcessor } from "./event-processor";
import type { SessionRuntime } from "./session-runtime";
import { MigrationConfig, type MigrationState } from "./types";

export interface MigrationControllerOptions {
	sessionId: string;
	runtime: SessionRuntime;
	eventProcessor: EventProcessor;
	broadcast: (message: ServerMessage) => void;
	broadcastStatus: (
		status: "creating" | "resuming" | "running" | "paused" | "stopped" | "error" | "migrating",
		message?: string,
	) => void;
	logger: Logger;
	getClientCount: () => number;
	env: GatewayEnv;
	shouldIdleSnapshot: () => boolean;
	onIdleSnapshotComplete: () => void;
	cancelReconnect: () => void;
	/** Best-effort telemetry flush before CAS writes. */
	flushTelemetry: () => Promise<void>;
}

/** Maximum consecutive idle snapshot failures before circuit-breaking. */
const MAX_SNAPSHOT_FAILURES = 3;

export class MigrationController {
	private readonly options: MigrationControllerOptions;
	private readonly logger: Logger;
	private migrationState: MigrationState = "normal";
	private started = false;
	private snapshotFailures = 0;

	constructor(options: MigrationControllerOptions) {
		this.options = options;
		this.logger = options.logger;
	}

	getState(): MigrationState {
		return this.migrationState;
	}

	start(): void {
		if (this.started) {
			return;
		}
		this.started = true;
		this.logger.info("Migration controller started");
	}

	stop(): void {
		if (!this.started) {
			return;
		}
		this.started = false;
		this.logger.info("Migration controller stopped");
	}

	async runExpiryMigration(): Promise<void> {
		if (this.migrationState !== "normal") {
			this.logger.info("Migration skipped: already migrating");
			return;
		}

		const startMs = Date.now();
		const hasClients = this.options.getClientCount() > 0;
		this.logger.debug({ hasClients }, "migration.run_expiry.start");
		await this.migrateToNewSandbox({ createNewSandbox: hasClients });
		this.logger.info({ durationMs: Date.now() - startMs }, "migration.run_expiry.complete");
	}

	/**
	 * Run idle snapshot with proper locking, re-validation, and CAS/fencing.
	 *
	 * Lock TTL is 300s (5 min) to cover worst-case snapshot (120s) + terminate + DB.
	 * Inside the lock: re-reads sandbox_id, re-checks shouldIdleSnapshot(),
	 * disconnects SSE before terminate, uses CAS update guarded by sandbox_id match,
	 * and cancels the BullMQ expiry job.
	 */
	async runIdleSnapshot(): Promise<void> {
		if (this.migrationState !== "normal") {
			this.logger.info("Idle snapshot skipped: already migrating");
			return;
		}

		// Early exit if no sandbox
		const sandboxId = this.options.runtime.getContext().session.sandbox_id;
		if (!sandboxId) return;

		// Circuit breaker: if too many failures, force-terminate to stop compute leak.
		if (this.snapshotFailures >= MAX_SNAPSHOT_FAILURES) {
			this.logger.error(
				{ failures: this.snapshotFailures },
				"Idle snapshot circuit-breaker tripped: force-terminating sandbox",
			);
			await this.forceTerminate(sandboxId);
			return;
		}

		const startMs = Date.now();
		this.logger.info("idle_snapshot.start");

		// Cancel reconnect timers to prevent races
		this.options.cancelReconnect();

		const ran = await runWithMigrationLock(this.options.sessionId, 300_000, async () => {
			try {
				// Re-read context after lock acquisition (may have changed while waiting)
				const freshSandboxId = this.options.runtime.getContext().session.sandbox_id;
				if (!freshSandboxId) {
					this.logger.info("Idle snapshot aborted: sandbox already gone");
					return;
				}

				// Re-check ALL idle conditions inside lock (including grace period)
				if (!this.options.shouldIdleSnapshot()) {
					this.logger.info("Idle snapshot aborted: conditions no longer met");
					return;
				}

				const providerType = this.options.runtime.getContext().session
					.sandbox_provider as SandboxProviderType;
				const provider = getSandboxProvider(providerType);

				// 1. Disconnect SSE BEFORE snapshot/terminate (prevents reconnect cycle)
				this.options.runtime.disconnectSse();

				// 2. Snapshot: memory (preferred) → pause → filesystem
				let snapshotId: string | undefined;

				if (provider.supportsMemorySnapshot && provider.memorySnapshot) {
					try {
						this.logger.info("Taking memory snapshot for idle shutdown");
						const memStartMs = Date.now();
						const result = await provider.memorySnapshot(this.options.sessionId, freshSandboxId);
						this.logger.debug(
							{ provider: provider.type, durationMs: Date.now() - memStartMs },
							"migration.memory_snapshot",
						);
						snapshotId = result.snapshotId;
					} catch (memErr) {
						this.logger.warn({ err: memErr }, "Memory snapshot failed, falling back to filesystem");
					}
				}

				if (!snapshotId && provider.supportsPause) {
					this.logger.info("Pausing sandbox for idle shutdown");
					const pauseStartMs = Date.now();
					const result = await provider.pause(this.options.sessionId, freshSandboxId);
					this.logger.debug(
						{ provider: provider.type, durationMs: Date.now() - pauseStartMs },
						"migration.pause",
					);
					snapshotId = result.snapshotId;
				}

				if (!snapshotId) {
					this.logger.info("Taking filesystem snapshot for idle shutdown");
					const snapStartMs = Date.now();
					const result = await provider.snapshot(this.options.sessionId, freshSandboxId);
					this.logger.debug(
						{ provider: provider.type, durationMs: Date.now() - snapStartMs },
						"migration.snapshot",
					);
					snapshotId = result.snapshotId;
				}

				// 3. Terminate (non-pause, non-memory-snapshot providers only)
				const isMemorySnapshot = snapshotId.startsWith("mem:");
				const keepSandbox = isMemorySnapshot || provider.supportsPause;
				if (!keepSandbox) {
					try {
						await provider.terminate(this.options.sessionId, freshSandboxId);
					} catch (err) {
						this.logger.error({ err }, "Failed to terminate after idle snapshot");
					}
				}

				// 4. Flush telemetry before CAS write (best-effort)
				try {
					await this.options.flushTelemetry();
				} catch (err) {
					this.logger.error({ err }, "Telemetry flush failed before idle snapshot CAS");
				}

				// 5. CAS/fencing DB update: only applies if sandbox_id still matches
				const rowsAffected = await sessions.updateWhereSandboxIdMatches(
					this.options.sessionId,
					freshSandboxId,
					{
						snapshotId,
						sandboxId: keepSandbox ? freshSandboxId : null,
						status: "paused",
						pausedAt: new Date().toISOString(),
						pauseReason: "inactivity",
						latestTask: null,
					},
				);

				if (rowsAffected === 0) {
					this.logger.info("Idle snapshot aborted: CAS mismatch (another actor advanced state)");
					// Still clean up local state since SSE is already disconnected
					this.options.runtime.resetSandboxState();
					this.options.onIdleSnapshotComplete();
					return;
				}

				// 6. Cancel BullMQ expiry job
				try {
					await cancelSessionExpiry(this.options.env, this.options.sessionId);
				} catch (err) {
					this.logger.error({ err }, "Failed to cancel session expiry after idle snapshot");
				}

				// 6b. Enqueue session completion notifications (best-effort)
				try {
					const orgId = this.options.runtime.getContext().session.organization_id;
					await notifications.enqueueSessionCompletionNotification(orgId, this.options.sessionId);
				} catch (err) {
					this.logger.error({ err }, "Failed to enqueue session completion notification");
				}

				// 7. Reset sandbox state and signal hub
				this.options.runtime.resetSandboxState();
				this.options.onIdleSnapshotComplete();
				this.snapshotFailures = 0;

				this.logger.info(
					{ sandboxId: freshSandboxId, snapshotId, durationMs: Date.now() - startMs },
					"idle_snapshot.complete",
				);
			} catch (err) {
				this.logger.error({ err }, "Idle snapshot failed");
				this.snapshotFailures++;
				this.logger.warn(
					{ failures: this.snapshotFailures, max: MAX_SNAPSHOT_FAILURES },
					"Idle snapshot failure recorded",
				);
				// Clean up local state even on failure since SSE is disconnected
				this.options.runtime.resetSandboxState();
				this.options.onIdleSnapshotComplete();
			}
		});

		if (ran === null) {
			this.logger.info("Idle snapshot skipped: lock already held");
		}
	}

	/**
	 * Force-terminate when circuit breaker trips.
	 * Prevents infinite billing by stopping the sandbox and marking DB as stopped.
	 */
	private async forceTerminate(sandboxId: string): Promise<void> {
		const providerType = this.options.runtime.getContext().session
			.sandbox_provider as SandboxProviderType;
		const provider = getSandboxProvider(providerType);

		this.options.runtime.disconnectSse();

		try {
			await provider.terminate(this.options.sessionId, sandboxId);
			this.logger.info({ sandboxId }, "Circuit breaker: sandbox terminated");
		} catch (err) {
			this.logger.error({ err, sandboxId }, "Circuit breaker: terminate failed");
		}

		// Best-effort telemetry flush
		try {
			await this.options.flushTelemetry();
		} catch (err) {
			this.logger.error({ err }, "Telemetry flush failed before force-terminate");
		}

		try {
			await sessions.update(this.options.sessionId, {
				status: "stopped",
				pauseReason: "snapshot_failed",
				latestTask: null,
				outcome: "failed",
			});
			await sessions.markSessionStopped(this.options.sessionId);
		} catch (err) {
			this.logger.error({ err }, "Circuit breaker: DB update failed");
		}

		// Enqueue session completion notifications (best-effort)
		try {
			const orgId = this.options.runtime.getContext().session.organization_id;
			await notifications.enqueueSessionCompletionNotification(orgId, this.options.sessionId);
		} catch (err) {
			this.logger.error({ err }, "Failed to enqueue session completion notification");
		}

		this.options.runtime.resetSandboxState();
		this.options.onIdleSnapshotComplete();
	}

	private async migrateToNewSandbox(options: { createNewSandbox: boolean }): Promise<void> {
		const { createNewSandbox } = options;
		const context = this.options.runtime.getContext();
		const sandboxId = context.session.sandbox_id;
		if (!sandboxId) {
			this.logger.info("Migration skipped: no sandbox");
			return;
		}

		const ran = await runWithMigrationLock(this.options.sessionId, 60_000, async () => {
			try {
				const migrationStartMs = Date.now();
				const oldSandboxId = sandboxId;
				const providerType = context.session.sandbox_provider as SandboxProviderType;
				const provider = getSandboxProvider(providerType);

				this.logger.debug({ createNewSandbox, provider: provider.type }, "migration.lock_acquired");

				if (createNewSandbox) {
					this.migrationState = "migrating";
					this.options.broadcastStatus("migrating", "Extending session...");
				}

				// Give OpenCode a chance to finish, then abort if needed before snapshotting
				const stopStartMs = Date.now();
				await this.ensureOpenCodeStopped(MigrationConfig.MESSAGE_COMPLETE_TIMEOUT_MS);
				this.logger.debug(
					{ durationMs: Date.now() - stopStartMs },
					"migration.ensure_opencode_stopped",
				);

				if (createNewSandbox) {
					// Take snapshot
					this.logger.info({ createNewSandbox }, "Taking snapshot before migration");
					const snapshotStartMs = Date.now();
					const { snapshotId } = await provider.snapshot(this.options.sessionId, sandboxId);
					this.logger.debug(
						{ provider: provider.type, durationMs: Date.now() - snapshotStartMs },
						"migration.snapshot",
					);

					// Update session with new snapshot
					const dbStartMs = Date.now();
					await sessions.update(this.options.sessionId, { snapshotId });
					this.logger.debug({ durationMs: Date.now() - dbStartMs }, "migration.db.update_snapshot");
					this.logger.info({ snapshotId }, "Snapshot saved");

					// Disconnect and create new sandbox
					this.options.runtime.disconnectSse();

					// Clear sandbox state to force new sandbox creation
					this.options.runtime.resetSandboxState();

					// Re-initialize
					this.logger.info("Creating new sandbox from snapshot...");
					const reinitStartMs = Date.now();
					await this.options.runtime.ensureRuntimeReady({ skipMigrationLock: true });
					this.logger.debug(
						{ durationMs: Date.now() - reinitStartMs },
						"migration.reinit_runtime_ready",
					);

					this.migrationState = "normal";
					this.options.broadcastStatus("running");
					this.logger.info(
						{ oldSandboxId, newSandboxId: this.options.runtime.getContext().session.sandbox_id },
						"Migration complete",
					);
				} else {
					// Expiry idle path: pause/snapshot, then stop the sandbox.
					// Cancel reconnect timers to prevent races.
					this.options.cancelReconnect();
					this.options.runtime.disconnectSse();

					let snapshotId: string;
					if (provider.supportsPause) {
						const pauseStartMs = Date.now();
						const result = await provider.pause(this.options.sessionId, sandboxId);
						this.logger.debug(
							{ provider: provider.type, durationMs: Date.now() - pauseStartMs },
							"migration.pause",
						);
						snapshotId = result.snapshotId;
					} else {
						const snapshotStartMs = Date.now();
						const result = await provider.snapshot(this.options.sessionId, sandboxId);
						this.logger.debug(
							{ provider: provider.type, durationMs: Date.now() - snapshotStartMs },
							"migration.snapshot",
						);
						snapshotId = result.snapshotId;
					}

					// Terminate (non-pause providers only)
					let terminated = provider.supportsPause;
					if (!provider.supportsPause) {
						try {
							await provider.terminate(this.options.sessionId, sandboxId);
							terminated = true;
						} catch (err) {
							this.logger.error({ err }, "Failed to terminate after expiry snapshot");
						}
					}

					// Flush telemetry before CAS write (best-effort)
					try {
						await this.options.flushTelemetry();
					} catch (err) {
						this.logger.error({ err }, "Telemetry flush failed before expiry CAS");
					}

					// CAS DB update for expiry path too
					const rowsAffected = await sessions.updateWhereSandboxIdMatches(
						this.options.sessionId,
						sandboxId,
						{
							snapshotId,
							sandboxId: provider.supportsPause ? sandboxId : terminated ? null : sandboxId,
							status: "paused",
							pausedAt: new Date().toISOString(),
							pauseReason: "inactivity",
							latestTask: null,
						},
					);

					if (rowsAffected === 0) {
						this.logger.info("Expiry snapshot: CAS mismatch, another actor advanced state");
					} else {
						// Enqueue session completion notifications (best-effort)
						try {
							const orgId = this.options.runtime.getContext().session.organization_id;
							await notifications.enqueueSessionCompletionNotification(
								orgId,
								this.options.sessionId,
							);
						} catch (err) {
							this.logger.error({ err }, "Failed to enqueue session completion notification");
						}
					}

					this.options.runtime.resetSandboxState();
					this.stop();
					this.logger.info(
						{ oldSandboxId, snapshotId },
						"Expiry idle path complete, session paused",
					);
				}

				this.logger.info(
					{
						durationMs: Date.now() - migrationStartMs,
						createNewSandbox,
						provider: provider.type,
					},
					"migration.complete",
				);
			} catch (err) {
				this.logger.error({ err }, "Migration failed (best-effort)");
				this.migrationState = "normal";
			}
		});

		if (ran === null) {
			this.logger.info("Migration skipped: lock already held");
			this.logger.debug("migration.lock_skipped");
		}
	}

	private async waitForMessageComplete(timeoutMs: number): Promise<void> {
		if (!this.options.eventProcessor.getCurrentAssistantMessageId()) {
			return;
		}

		const startTime = Date.now();
		const checkInterval = 500;

		while (
			this.options.eventProcessor.getCurrentAssistantMessageId() &&
			Date.now() - startTime < timeoutMs
		) {
			await this.sleep(checkInterval);
		}

		if (this.options.eventProcessor.getCurrentAssistantMessageId()) {
			this.logger.info("Message did not complete before timeout, will abort");
		} else {
			this.logger.info("Message completed, proceeding with migration");
		}
	}

	private async ensureOpenCodeStopped(timeoutMs: number): Promise<void> {
		const openCodeUrl = this.options.runtime.getOpenCodeUrl();
		const openCodeSessionId = this.options.runtime.getOpenCodeSessionId();
		if (!openCodeUrl || !openCodeSessionId) {
			return;
		}

		if (this.options.eventProcessor.getCurrentAssistantMessageId()) {
			this.logger.info("Waiting for OpenCode to finish before snapshot");
			await this.waitForMessageComplete(timeoutMs);
		}

		if (this.options.eventProcessor.getCurrentAssistantMessageId()) {
			this.logger.info("Aborting OpenCode session before snapshot");
			try {
				await abortOpenCodeSession(openCodeUrl, openCodeSessionId);

				const messageId = this.options.eventProcessor.getCurrentAssistantMessageId();
				this.options.broadcast({
					type: "message_cancelled",
					payload: { messageId: messageId || undefined },
				});

				this.options.eventProcessor.clearCurrentAssistantMessageId();
				this.logger.info("OpenCode session aborted");
			} catch (err) {
				this.logger.error({ err }, "Failed to abort OpenCode session (proceeding anyway)");
			}
		}
	}

	private async sleep(durationMs: number): Promise<void> {
		await new Promise((resolve) => setTimeout(resolve, durationMs));
	}
}
