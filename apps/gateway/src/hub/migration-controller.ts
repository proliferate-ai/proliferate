/**
 * Migration Controller
 *
 * Schedules snapshot-before-expiry and handles sandbox migration.
 */

import type { Logger } from "@proliferate/logger";
import { sessions } from "@proliferate/services";
import type { SandboxProviderType, ServerMessage } from "@proliferate/shared";
import { getSandboxProvider } from "@proliferate/shared/providers";
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
}

export class MigrationController {
	private readonly options: MigrationControllerOptions;
	private migrationState: MigrationState = "normal";
	private started = false;

	constructor(options: MigrationControllerOptions) {
		this.options = options;
	}

	getState(): MigrationState {
		return this.migrationState;
	}

	start(): void {
		if (this.started) {
			return;
		}
		this.started = true;
		this.options.logger.info("Migration controller started");
	}

	stop(): void {
		if (!this.started) {
			return;
		}
		this.started = false;
		this.options.logger.info("Migration controller stopped");
	}

	async runExpiryMigration(): Promise<void> {
		if (this.migrationState !== "normal") {
			this.options.logger.info("Migration skipped: already migrating");
			return;
		}

		const startMs = Date.now();
		const hasClients = this.options.getClientCount() > 0;
		this.options.logger.debug({ latency: true, hasClients }, "migration.run_expiry.start");
		await this.migrateToNewSandbox({ createNewSandbox: hasClients });
		this.options.logger.info({ latency: true, durationMs: Date.now() - startMs }, "migration.run_expiry.complete");
	}

	private async migrateToNewSandbox(options: { createNewSandbox: boolean }): Promise<void> {
		const { createNewSandbox } = options;
		const context = this.options.runtime.getContext();
		const sandboxId = context.session.sandbox_id;
		if (!sandboxId) {
			this.options.logger.info("Migration skipped: no sandbox");
			return;
		}

		const ran = await runWithMigrationLock(this.options.sessionId, 60_000, async () => {
			try {
				const migrationStartMs = Date.now();
				const oldSandboxId = sandboxId;
				const providerType = context.session.sandbox_provider as SandboxProviderType;
				const provider = getSandboxProvider(providerType);

				this.options.logger.debug({ latency: true, createNewSandbox, provider: provider.type }, "migration.lock_acquired");

				if (createNewSandbox) {
					this.migrationState = "migrating";
					this.options.broadcastStatus("migrating", "Extending session...");
				}

				// Give OpenCode a chance to finish, then abort if needed before snapshotting
				const stopStartMs = Date.now();
				await this.ensureOpenCodeStopped(MigrationConfig.MESSAGE_COMPLETE_TIMEOUT_MS);
				this.options.logger.debug({ latency: true, durationMs: Date.now() - stopStartMs }, "migration.ensure_opencode_stopped");

				if (createNewSandbox) {
					// Take snapshot
					this.options.logger.info({ createNewSandbox }, "Taking snapshot before migration");
					const snapshotStartMs = Date.now();
					const { snapshotId } = await provider.snapshot(this.options.sessionId, sandboxId);
					this.options.logger.debug({ latency: true, provider: provider.type, durationMs: Date.now() - snapshotStartMs }, "migration.snapshot");

					// Update session with new snapshot
					const dbStartMs = Date.now();
					await sessions.update(this.options.sessionId, { snapshotId });
					this.options.logger.debug({ latency: true, durationMs: Date.now() - dbStartMs }, "migration.db.update_snapshot");
					this.options.logger.info({ snapshotId }, "Snapshot saved");

					// Disconnect and create new sandbox
					this.options.runtime.disconnectSse();

					// Clear sandbox state to force new sandbox creation
					this.options.runtime.resetSandboxState();

					// Re-initialize
					this.options.logger.info("Creating new sandbox from snapshot...");
					const reinitStartMs = Date.now();
					await this.options.runtime.ensureRuntimeReady({ skipMigrationLock: true });
					this.options.logger.debug({ latency: true, durationMs: Date.now() - reinitStartMs }, "migration.reinit_runtime_ready");

					this.migrationState = "normal";
					this.options.broadcastStatus("running");
					this.options.logger.info({ oldSandboxId, newSandboxId: this.options.runtime.getContext().session.sandbox_id }, "Migration complete");
				} else {
					// Idle migration: pause (if supported) or snapshot, then stop the sandbox.
					let snapshotId: string;
					if (provider.supportsPause) {
						this.options.logger.info("Pausing sandbox before idle shutdown");
						const pauseStartMs = Date.now();
						const result = await provider.pause(this.options.sessionId, sandboxId);
						this.options.logger.debug({ latency: true, provider: provider.type, durationMs: Date.now() - pauseStartMs }, "migration.pause");
						snapshotId = result.snapshotId;
						this.options.logger.info({ snapshotId }, "Sandbox paused");
					} else {
						this.options.logger.info("Taking snapshot before idle shutdown");
						const snapshotStartMs = Date.now();
						const result = await provider.snapshot(this.options.sessionId, sandboxId);
						this.options.logger.debug({ latency: true, provider: provider.type, durationMs: Date.now() - snapshotStartMs }, "migration.snapshot");
						snapshotId = result.snapshotId;
						this.options.logger.info({ snapshotId }, "Snapshot saved");
					}

					const dbStartMs = Date.now();
					await sessions.update(this.options.sessionId, { snapshotId });
					this.options.logger.debug({ latency: true, durationMs: Date.now() - dbStartMs }, "migration.db.update_snapshot");

					if (!provider.supportsPause) {
						try {
							const terminateStartMs = Date.now();
							await provider.terminate(this.options.sessionId, sandboxId);
							this.options.logger.debug({ latency: true, provider: provider.type, durationMs: Date.now() - terminateStartMs }, "migration.terminate");
							this.options.logger.info({ sandboxId: oldSandboxId }, "Sandbox terminated after idle snapshot");
						} catch (err) {
							this.options.logger.error({ err }, "Failed to terminate sandbox after idle snapshot");
						}
					}
					this.options.runtime.resetSandboxState();
					this.options.runtime.disconnectSse();
					this.stop();
					this.options.logger.info({ oldSandboxId, snapshotId }, "Idle snapshot complete, sandbox stopped");
				}

				this.options.logger.info({ latency: true, durationMs: Date.now() - migrationStartMs, createNewSandbox, provider: provider.type }, "migration.complete");
			} catch (err) {
				this.options.logger.error({ err }, "Migration failed (best-effort)");
				this.migrationState = "normal";
			}
		});

		if (ran === null) {
			this.options.logger.info("Migration skipped: lock already held");
			this.options.logger.debug({ latency: true }, "migration.lock_skipped");
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
			this.options.logger.info("Message did not complete before timeout, will abort");
		} else {
			this.options.logger.info("Message completed, proceeding with migration");
		}
	}

	private async ensureOpenCodeStopped(timeoutMs: number): Promise<void> {
		const openCodeUrl = this.options.runtime.getOpenCodeUrl();
		const openCodeSessionId = this.options.runtime.getOpenCodeSessionId();
		if (!openCodeUrl || !openCodeSessionId) {
			return;
		}

		if (this.options.eventProcessor.getCurrentAssistantMessageId()) {
			this.options.logger.info("Waiting for OpenCode to finish before snapshot");
			await this.waitForMessageComplete(timeoutMs);
		}

		if (this.options.eventProcessor.getCurrentAssistantMessageId()) {
			this.options.logger.info("Aborting OpenCode session before snapshot");
			try {
				await abortOpenCodeSession(openCodeUrl, openCodeSessionId);

				const messageId = this.options.eventProcessor.getCurrentAssistantMessageId();
				this.options.broadcast({
					type: "message_cancelled",
					payload: { messageId: messageId || undefined },
				});

				this.options.eventProcessor.clearCurrentAssistantMessageId();
				this.options.logger.info("OpenCode session aborted");
			} catch (err) {
				this.options.logger.error({ err }, "Failed to abort OpenCode session (proceeding anyway)");
			}
		}
	}

	private async sleep(durationMs: number): Promise<void> {
		await new Promise((resolve) => setTimeout(resolve, durationMs));
	}
}
