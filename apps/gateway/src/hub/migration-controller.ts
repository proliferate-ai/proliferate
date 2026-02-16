/**
 * Migration Controller
 *
 * Schedules snapshot-before-expiry and handles sandbox migration.
 */

import type { Logger } from "@proliferate/logger";
import { sessions } from "@proliferate/services";
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
}

export class MigrationController {
	private readonly options: MigrationControllerOptions;
	private readonly logger: Logger;
	private migrationState: MigrationState = "normal";
	private started = false;

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

		const startMs = Date.now();
		this.logger.info("idle_snapshot.start");

		const ran = await runWithMigrationLock(this.options.sessionId, 300_000, async () => {
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

			// 1. Disconnect SSE BEFORE terminate (prevents reconnect cycle)
			this.options.runtime.disconnectSse();

			// 2. Snapshot
			let snapshotId: string;
			if (provider.supportsPause) {
				this.logger.info("Pausing sandbox for idle snapshot");
				const result = await provider.pause(this.options.sessionId, freshSandboxId);
				snapshotId = result.snapshotId;
			} else {
				this.logger.info("Taking snapshot for idle snapshot");
				const result = await provider.snapshot(this.options.sessionId, freshSandboxId);
				snapshotId = result.snapshotId;
			}

			// 3. Terminate (non-pause providers only)
			let terminated = provider.supportsPause;
			if (!provider.supportsPause) {
				try {
					await provider.terminate(this.options.sessionId, freshSandboxId);
					terminated = true;
				} catch (err) {
					this.logger.error({ err }, "Failed to terminate after idle snapshot");
					terminated = false;
				}
			}

			// 4. CAS/fencing DB update: only applies if sandbox_id still matches
			const rowsAffected = await sessions.updateWhereSandboxIdMatches(
				this.options.sessionId,
				freshSandboxId,
				{
					snapshotId,
					sandboxId: provider.supportsPause ? freshSandboxId : terminated ? null : freshSandboxId,
					status: "paused",
					pausedAt: new Date().toISOString(),
					pauseReason: "inactivity",
				},
			);

			if (rowsAffected === 0) {
				this.logger.info("Idle snapshot aborted: CAS mismatch (another actor advanced state)");
				return;
			}

			// 5. Cancel BullMQ expiry job
			try {
				await cancelSessionExpiry(this.options.env, this.options.sessionId);
			} catch (err) {
				this.logger.error({ err }, "Failed to cancel session expiry after idle snapshot");
			}

			// 6. Reset sandbox state
			this.options.runtime.resetSandboxState();

			// 7. Signal hub: stop idle timer and clear state
			this.options.onIdleSnapshotComplete();

			this.logger.info(
				{ sandboxId: freshSandboxId, snapshotId, durationMs: Date.now() - startMs },
				"idle_snapshot.complete",
			);
		});

		if (ran === null) {
			this.logger.info("Idle snapshot skipped: lock already held");
		}
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

				// Cancel any pending reconnect timers to prevent races
				if (!createNewSandbox) {
					this.options.cancelReconnect();
				}

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
					// Idle/expiry migration: pause (if supported) or snapshot, then pause the session.
					// Disconnect SSE BEFORE terminate to prevent reconnect cycle.
					this.options.runtime.disconnectSse();

					let snapshotId: string;
					if (provider.supportsPause) {
						this.logger.info("Pausing sandbox before idle shutdown");
						const pauseStartMs = Date.now();
						const result = await provider.pause(this.options.sessionId, sandboxId);
						this.logger.debug(
							{ provider: provider.type, durationMs: Date.now() - pauseStartMs },
							"migration.pause",
						);
						snapshotId = result.snapshotId;
						this.logger.info({ snapshotId }, "Sandbox paused");
					} else {
						this.logger.info("Taking snapshot before idle shutdown");
						const snapshotStartMs = Date.now();
						const result = await provider.snapshot(this.options.sessionId, sandboxId);
						this.logger.debug(
							{ provider: provider.type, durationMs: Date.now() - snapshotStartMs },
							"migration.snapshot",
						);
						snapshotId = result.snapshotId;
						this.logger.info({ snapshotId }, "Snapshot saved");
					}

					// Terminate (non-pause providers only)
					let terminated = provider.supportsPause;
					if (!provider.supportsPause) {
						try {
							const terminateStartMs = Date.now();
							await provider.terminate(this.options.sessionId, sandboxId);
							this.logger.debug(
								{
									provider: provider.type,
									durationMs: Date.now() - terminateStartMs,
								},
								"migration.terminate",
							);
							terminated = true;
							this.logger.info(
								{ sandboxId: oldSandboxId },
								"Sandbox terminated after idle snapshot",
							);
						} catch (err) {
							this.logger.error({ err }, "Failed to terminate sandbox after idle snapshot");
							terminated = false;
						}
					}

					// Unified paused state — no markSessionStopped, no endedAt
					const dbStartMs = Date.now();
					await sessions.update(this.options.sessionId, {
						snapshotId,
						sandboxId: provider.supportsPause ? sandboxId : terminated ? null : sandboxId,
						status: "paused",
						pausedAt: new Date().toISOString(),
						pauseReason: "inactivity",
					});
					this.logger.debug({ durationMs: Date.now() - dbStartMs }, "migration.db.update_snapshot");

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
