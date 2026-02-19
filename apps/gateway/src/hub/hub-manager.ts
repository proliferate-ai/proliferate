/**
 * Hub Manager
 *
 * Registry for SessionHub instances.
 * Handles creation and lifecycle of hubs.
 */

import type { GatewayEnv } from "../lib/env";
import { loadSessionContext } from "../lib/session-store";
import { SessionHub } from "./session-hub";

export class HubManager {
	private readonly hubs = new Map<string, SessionHub>();
	private readonly pending = new Map<string, Promise<SessionHub>>();
	private readonly env: GatewayEnv;

	constructor(env: GatewayEnv) {
		this.env = env;
	}

	/**
	 * Get or create a SessionHub for the given session ID.
	 * Loads session context on first creation.
	 */
	async getOrCreate(sessionId: string): Promise<SessionHub> {
		const existing = this.hubs.get(sessionId);
		if (existing) {
			return existing;
		}
		const pending = this.pending.get(sessionId);
		if (pending) {
			return pending;
		}

		const createPromise = (async () => {
			// Load session context from database
			const context = await loadSessionContext(this.env, sessionId);

			const hub = new SessionHub({
				env: this.env,
				sessionId,
				context,
				onEvict: () => this.remove(sessionId),
			});

			this.hubs.set(sessionId, hub);
			return hub;
		})().finally(() => {
			this.pending.delete(sessionId);
		});

		this.pending.set(sessionId, createPromise);
		return createPromise;
	}

	/**
	 * Get an existing hub without creating one.
	 * Returns undefined if hub doesn't exist.
	 */
	get(sessionId: string): SessionHub | undefined {
		return this.hubs.get(sessionId);
	}

	/**
	 * Remove a hub from the registry.
	 * Should be called when a session is terminated.
	 */
	remove(sessionId: string): void {
		const hub = this.hubs.get(sessionId);
		if (hub) {
			hub.stopMigrationMonitor();
			this.hubs.delete(sessionId);
		}
	}

	/**
	 * Get all active session IDs.
	 */
	getActiveSessionIds(): string[] {
		return Array.from(this.hubs.keys());
	}

	/**
	 * Release all owner/runtime leases. Called on graceful shutdown
	 * so a restarted instance can immediately re-acquire sessions.
	 * Flushes telemetry for all hubs (best-effort) before cleanup.
	 */
	async releaseAllLeases(): Promise<void> {
		const flushPromises = Array.from(this.hubs.values()).map((hub) =>
			hub.flushTelemetry().catch(() => {
				// best-effort — individual hub flush failures are non-fatal
			}),
		);
		await Promise.allSettled(flushPromises);
		for (const [sessionId, hub] of this.hubs) {
			hub.stopMigrationMonitor();
			this.hubs.delete(sessionId);
		}
	}
}
