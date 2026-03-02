/**
 * Preview port discovery — B5: dynamic port polling + stability gating.
 *
 * Polls `ss -tln` to discover listening ports.
 * Stability gating: port must be seen listening for PORT_STABILITY_THRESHOLD
 * consecutive polls before emitting port_opened.
 * Allowlisted port range: 3000-9999.
 * Denylisted infra ports: 22, 2375, 2376, 4096, 26500.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { Logger } from "@proliferate/logger";
import {
	DENYLISTED_PORTS,
	PORT_POLL_INTERVAL_MS,
	PORT_STABILITY_THRESHOLD,
	PREVIEW_PORT_MAX,
	PREVIEW_PORT_MIN,
} from "./config.js";
import type { EventBus } from "./event-bus.js";

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Port state
// ---------------------------------------------------------------------------

interface PortState {
	port: number;
	/** Number of consecutive polls the port has been seen listening. */
	stableCount: number;
	/** Whether we have emitted port_opened for this port. */
	announced: boolean;
}

// ---------------------------------------------------------------------------
// Port watcher
// ---------------------------------------------------------------------------

export interface PortWatcherOptions {
	eventBus: EventBus;
	logger: Logger;
	pollIntervalMs?: number;
}

export class PortWatcher {
	private readonly eventBus: EventBus;
	private readonly logger: Logger;
	private readonly pollIntervalMs: number;
	private readonly ports = new Map<number, PortState>();
	private pollTimer: NodeJS.Timeout | null = null;
	private stopped = false;

	constructor(options: PortWatcherOptions) {
		this.eventBus = options.eventBus;
		this.logger = options.logger.child({ module: "ports" });
		this.pollIntervalMs = options.pollIntervalMs ?? PORT_POLL_INTERVAL_MS;
	}

	/**
	 * Start polling for listening ports.
	 */
	start(): void {
		this.stopped = false;
		this.poll();
	}

	/**
	 * Stop polling.
	 */
	stop(): void {
		this.stopped = true;
		if (this.pollTimer) {
			clearTimeout(this.pollTimer);
			this.pollTimer = null;
		}
	}

	/**
	 * Get currently active (announced) preview ports.
	 */
	getActivePorts(): number[] {
		const result: number[] = [];
		for (const state of this.ports.values()) {
			if (state.announced) {
				result.push(state.port);
			}
		}
		return result.sort((a, b) => a - b);
	}

	// -----------------------------------------------------------------------
	// Internal
	// -----------------------------------------------------------------------

	private poll(): void {
		if (this.stopped) return;

		this.doPoll()
			.catch((err) => {
				this.logger.warn({ err }, "Port poll failed");
			})
			.finally(() => {
				if (!this.stopped) {
					this.pollTimer = setTimeout(() => this.poll(), this.pollIntervalMs);
				}
			});
	}

	private async doPoll(): Promise<void> {
		const listening = await this.getListeningPorts();

		// Update stability counts
		for (const port of listening) {
			if (!this.isPortAllowed(port)) continue;

			let state = this.ports.get(port);
			if (!state) {
				state = { port, stableCount: 0, announced: false };
				this.ports.set(port, state);
			}
			state.stableCount++;

			// Stability gate: announce after threshold
			if (state.stableCount >= PORT_STABILITY_THRESHOLD && !state.announced) {
				state.announced = true;
				this.logger.info({ port }, "Preview port opened");
				this.eventBus.emit("port_opened", "data", { port });
			}
		}

		// Detect ports that have closed
		for (const [port, state] of this.ports) {
			if (!listening.has(port)) {
				if (state.announced) {
					this.logger.info({ port }, "Preview port closed");
					this.eventBus.emit("port_closed", "data", { port });
				}
				this.ports.delete(port);
			}
		}
	}

	private isPortAllowed(port: number): boolean {
		if (DENYLISTED_PORTS.has(port)) return false;
		return port >= PREVIEW_PORT_MIN && port <= PREVIEW_PORT_MAX;
	}

	private async getListeningPorts(): Promise<Set<number>> {
		const ports = new Set<number>();
		try {
			const { stdout } = await execAsync("ss -tln", { timeout: 5000 });
			// Parse ss output: lines like "LISTEN  0  128  0.0.0.0:3000  0.0.0.0:*"
			for (const line of stdout.split("\n")) {
				if (!line.includes("LISTEN")) continue;
				const match = line.match(/:(\d+)\s/);
				if (match) {
					const port = Number.parseInt(match[1], 10);
					if (!Number.isNaN(port)) {
						ports.add(port);
					}
				}
			}
		} catch {
			// ss not available or failed — return empty set
		}
		return ports;
	}
}
