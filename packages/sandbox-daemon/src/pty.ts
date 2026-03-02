/**
 * PTY transport — B3: attach, input, replay APIs.
 *
 * Per-process ring buffer: max 10,000 lines or 8 MB.
 * Max line length 16 KB (truncated).
 * Reconnect uses last_seq for delta replay.
 * Cold restart resets buffer; client falls back to DB history.
 */

import type { Logger } from "@proliferate/logger";
import { PTY_MAX_BYTES, PTY_MAX_LINES, PTY_MAX_LINE_LENGTH } from "./config.js";
import type { EventBus } from "./event-bus.js";

// ---------------------------------------------------------------------------
// Ring buffer
// ---------------------------------------------------------------------------

interface PtyLine {
	seq: number;
	data: string;
	ts: number;
}

class PtyRingBuffer {
	private lines: PtyLine[] = [];
	private seq = 0;
	private totalBytes = 0;

	push(data: string): PtyLine {
		this.seq++;
		// Truncate lines exceeding max length
		const truncated = data.length > PTY_MAX_LINE_LENGTH ? data.slice(0, PTY_MAX_LINE_LENGTH) : data;

		const line: PtyLine = {
			seq: this.seq,
			data: truncated,
			ts: Date.now(),
		};
		this.lines.push(line);
		this.totalBytes += truncated.length;

		// Evict oldest entries if over limits
		while (this.lines.length > PTY_MAX_LINES || this.totalBytes > PTY_MAX_BYTES) {
			const evicted = this.lines.shift();
			if (evicted) {
				this.totalBytes -= evicted.data.length;
			}
		}

		return line;
	}

	/**
	 * Get lines since (exclusive) the given sequence number.
	 * Returns all lines if lastSeq is 0 or undefined.
	 */
	since(lastSeq: number): PtyLine[] {
		if (lastSeq <= 0 || this.lines.length === 0) {
			return [...this.lines];
		}
		return this.lines.filter((l) => l.seq > lastSeq);
	}

	getLatestSeq(): number {
		return this.seq;
	}

	clear(): void {
		this.lines = [];
		this.totalBytes = 0;
		// seq is intentionally NOT reset — it monotonically increases
	}
}

// ---------------------------------------------------------------------------
// PTY process registry
// ---------------------------------------------------------------------------

interface PtyProcess {
	id: string;
	buffer: PtyRingBuffer;
	createdAt: number;
}

export interface PtyTransportOptions {
	eventBus: EventBus;
	logger: Logger;
}

export class PtyTransport {
	private readonly processes = new Map<string, PtyProcess>();
	private readonly eventBus: EventBus;
	private readonly logger: Logger;

	constructor(options: PtyTransportOptions) {
		this.eventBus = options.eventBus;
		this.logger = options.logger.child({ module: "pty" });
	}

	/**
	 * Register or get a PTY process by ID.
	 */
	ensureProcess(processId: string): PtyProcess {
		let proc = this.processes.get(processId);
		if (!proc) {
			proc = {
				id: processId,
				buffer: new PtyRingBuffer(),
				createdAt: Date.now(),
			};
			this.processes.set(processId, proc);
			this.logger.debug({ processId }, "PTY process registered");
		}
		return proc;
	}

	/**
	 * Write output data to a PTY process buffer.
	 * Splits on newlines and pushes each line independently.
	 */
	writeOutput(processId: string, data: string): void {
		const proc = this.ensureProcess(processId);
		const lines = data.split("\n");
		for (const line of lines) {
			if (line.length === 0) continue;
			const entry = proc.buffer.push(line);
			this.eventBus.emit("pty_out", "data", {
				processId,
				seq: entry.seq,
				data: entry.data,
				ts: entry.ts,
			});
		}
	}

	/**
	 * Replay PTY output since a given sequence number.
	 * Used for reconnect delta replay.
	 */
	replay(processId: string, lastSeq: number): PtyLine[] {
		const proc = this.processes.get(processId);
		if (!proc) return [];
		return proc.buffer.since(lastSeq);
	}

	/**
	 * Get the latest sequence number for a process.
	 */
	getLatestSeq(processId: string): number {
		const proc = this.processes.get(processId);
		return proc ? proc.buffer.getLatestSeq() : 0;
	}

	/**
	 * List registered PTY processes.
	 */
	listProcesses(): Array<{ id: string; latestSeq: number; createdAt: number }> {
		return [...this.processes.values()].map((p) => ({
			id: p.id,
			latestSeq: p.buffer.getLatestSeq(),
			createdAt: p.createdAt,
		}));
	}

	/**
	 * Remove a PTY process and its buffer.
	 */
	removeProcess(processId: string): boolean {
		return this.processes.delete(processId);
	}

	/**
	 * Clear all buffers. Used on cold restart.
	 */
	clearAll(): void {
		for (const proc of this.processes.values()) {
			proc.buffer.clear();
		}
		this.processes.clear();
	}
}
