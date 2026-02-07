/**
 * Migration Controller
 *
 * Schedules snapshot-before-expiry and handles sandbox migration.
 */

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
	log: (message: string, data?: Record<string, unknown>) => void;
	logError: (message: string, error?: unknown) => void;
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
		this.options.log("Migration controller started");
	}

	stop(): void {
		if (!this.started) {
			return;
		}
		this.started = false;
		this.options.log("Migration controller stopped");
	}

	async runExpiryMigration(): Promise<void> {
		if (this.migrationState !== "normal") {
			this.options.log("Migration skipped: already migrating");
			return;
		}

		const startMs = Date.now();
		const hasClients = this.options.getClientCount() > 0;
		console.log("[P-LATENCY] migration.run_expiry.start", {
			sessionId: this.options.sessionId,
			shortId: this.options.sessionId.slice(0, 8),
			hasClients,
		});
		await this.migrateToNewSandbox({ createNewSandbox: hasClients });
		console.log("[P-LATENCY] migration.run_expiry.complete", {
			sessionId: this.options.sessionId,
			shortId: this.options.sessionId.slice(0, 8),
			durationMs: Date.now() - startMs,
		});
	}

	private async migrateToNewSandbox(options: { createNewSandbox: boolean }): Promise<void> {
		const { createNewSandbox } = options;
		const context = this.options.runtime.getContext();
		const sandboxId = context.session.sandbox_id;
		if (!sandboxId) {
			this.options.log("Migration skipped: no sandbox");
			return;
		}

		const ran = await runWithMigrationLock(this.options.sessionId, 60_000, async () => {
			try {
				const migrationStartMs = Date.now();
				const oldSandboxId = sandboxId;
				const providerType = context.session.sandbox_provider as SandboxProviderType;
				const provider = getSandboxProvider(providerType);

				console.log("[P-LATENCY] migration.lock_acquired", {
					sessionId: this.options.sessionId,
					shortId: this.options.sessionId.slice(0, 8),
					createNewSandbox,
					provider: provider.type,
				});

				if (createNewSandbox) {
					this.migrationState = "migrating";
					this.options.broadcastStatus("migrating", "Extending session...");
				}

				// Give OpenCode a chance to finish, then abort if needed before snapshotting
				const stopStartMs = Date.now();
				await this.ensureOpenCodeStopped(MigrationConfig.MESSAGE_COMPLETE_TIMEOUT_MS);
				console.log("[P-LATENCY] migration.ensure_opencode_stopped", {
					sessionId: this.options.sessionId,
					shortId: this.options.sessionId.slice(0, 8),
					durationMs: Date.now() - stopStartMs,
				});

				if (createNewSandbox) {
					// Take snapshot
					this.options.log("Taking snapshot before migration", { createNewSandbox });
					const snapshotStartMs = Date.now();
					const { snapshotId } = await provider.snapshot(this.options.sessionId, sandboxId);
					console.log("[P-LATENCY] migration.snapshot", {
						sessionId: this.options.sessionId,
						shortId: this.options.sessionId.slice(0, 8),
						provider: provider.type,
						durationMs: Date.now() - snapshotStartMs,
					});

					// Update session with new snapshot
					const dbStartMs = Date.now();
					await sessions.update(this.options.sessionId, { snapshotId });
					console.log("[P-LATENCY] migration.db.update_snapshot", {
						sessionId: this.options.sessionId,
						shortId: this.options.sessionId.slice(0, 8),
						durationMs: Date.now() - dbStartMs,
					});
					this.options.log("Snapshot saved", { snapshotId });

					// Disconnect and create new sandbox
					this.options.runtime.disconnectSse();

					// Clear sandbox state to force new sandbox creation
					this.options.runtime.resetSandboxState();

					// Re-initialize
					this.options.log("Creating new sandbox from snapshot...");
					const reinitStartMs = Date.now();
					await this.options.runtime.ensureRuntimeReady({ skipMigrationLock: true });
					console.log("[P-LATENCY] migration.reinit_runtime_ready", {
						sessionId: this.options.sessionId,
						shortId: this.options.sessionId.slice(0, 8),
						durationMs: Date.now() - reinitStartMs,
					});

					this.migrationState = "normal";
					this.options.broadcastStatus("running");
					this.options.log("Migration complete", {
						oldSandboxId,
						newSandboxId: this.options.runtime.getContext().session.sandbox_id,
					});
				} else {
					// Idle migration: pause (if supported) or snapshot, then stop the sandbox.
					let snapshotId: string;
					if (provider.supportsPause) {
						this.options.log("Pausing sandbox before idle shutdown");
						const pauseStartMs = Date.now();
						const result = await provider.pause(this.options.sessionId, sandboxId);
						console.log("[P-LATENCY] migration.pause", {
							sessionId: this.options.sessionId,
							shortId: this.options.sessionId.slice(0, 8),
							provider: provider.type,
							durationMs: Date.now() - pauseStartMs,
						});
						snapshotId = result.snapshotId;
						this.options.log("Sandbox paused", { snapshotId });
					} else {
						this.options.log("Taking snapshot before idle shutdown");
						const snapshotStartMs = Date.now();
						const result = await provider.snapshot(this.options.sessionId, sandboxId);
						console.log("[P-LATENCY] migration.snapshot", {
							sessionId: this.options.sessionId,
							shortId: this.options.sessionId.slice(0, 8),
							provider: provider.type,
							durationMs: Date.now() - snapshotStartMs,
						});
						snapshotId = result.snapshotId;
						this.options.log("Snapshot saved", { snapshotId });
					}

					const dbStartMs = Date.now();
					await sessions.update(this.options.sessionId, { snapshotId });
					console.log("[P-LATENCY] migration.db.update_snapshot", {
						sessionId: this.options.sessionId,
						shortId: this.options.sessionId.slice(0, 8),
						durationMs: Date.now() - dbStartMs,
					});

					if (!provider.supportsPause) {
						try {
							const terminateStartMs = Date.now();
							await provider.terminate(this.options.sessionId, sandboxId);
							console.log("[P-LATENCY] migration.terminate", {
								sessionId: this.options.sessionId,
								shortId: this.options.sessionId.slice(0, 8),
								provider: provider.type,
								durationMs: Date.now() - terminateStartMs,
							});
							this.options.log("Sandbox terminated after idle snapshot", {
								sandboxId: oldSandboxId,
							});
						} catch (err) {
							this.options.logError("Failed to terminate sandbox after idle snapshot", err);
						}
					}
					this.options.runtime.resetSandboxState();
					this.options.runtime.disconnectSse();
					this.stop();
					this.options.log("Idle snapshot complete, sandbox stopped", {
						oldSandboxId,
						snapshotId,
					});
				}

				console.log("[P-LATENCY] migration.complete", {
					sessionId: this.options.sessionId,
					shortId: this.options.sessionId.slice(0, 8),
					durationMs: Date.now() - migrationStartMs,
					createNewSandbox,
					provider: provider.type,
				});
			} catch (err) {
				this.options.logError("Migration failed (best-effort)", err);
				console.error("[P-LATENCY] migration.error", {
					sessionId: this.options.sessionId,
					shortId: this.options.sessionId.slice(0, 8),
					error: err instanceof Error ? err.message : "Unknown error",
				});
				this.migrationState = "normal";
			}
		});

		if (ran === null) {
			this.options.log("Migration skipped: lock already held");
			console.log("[P-LATENCY] migration.lock_skipped", {
				sessionId: this.options.sessionId,
				shortId: this.options.sessionId.slice(0, 8),
			});
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
			this.options.log("Message did not complete before timeout, will abort");
		} else {
			this.options.log("Message completed, proceeding with migration");
		}
	}

	private async ensureOpenCodeStopped(timeoutMs: number): Promise<void> {
		const openCodeUrl = this.options.runtime.getOpenCodeUrl();
		const openCodeSessionId = this.options.runtime.getOpenCodeSessionId();
		if (!openCodeUrl || !openCodeSessionId) {
			return;
		}

		if (this.options.eventProcessor.getCurrentAssistantMessageId()) {
			this.options.log("Waiting for OpenCode to finish before snapshot");
			await this.waitForMessageComplete(timeoutMs);
		}

		if (this.options.eventProcessor.getCurrentAssistantMessageId()) {
			this.options.log("Aborting OpenCode session before snapshot");
			try {
				await abortOpenCodeSession(openCodeUrl, openCodeSessionId);

				const messageId = this.options.eventProcessor.getCurrentAssistantMessageId();
				this.options.broadcast({
					type: "message_cancelled",
					payload: { messageId: messageId || undefined },
				});

				this.options.eventProcessor.clearCurrentAssistantMessageId();
				this.options.log("OpenCode session aborted");
			} catch (err) {
				this.options.logError("Failed to abort OpenCode session (proceeding anyway)", err);
			}
		}
	}

	private async sleep(durationMs: number): Promise<void> {
		await new Promise((resolve) => setTimeout(resolve, durationMs));
	}
}
