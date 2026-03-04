/**
 * Session Telemetry
 *
 * Pure in-memory counter class owned by each SessionHub.
 * Accumulates deltas for metrics, PR URLs, and latest task,
 * then flushes to DB via a provided callback.
 */

// ============================================
// PR URL Extraction (pure, testable)
// ============================================

const GITHUB_PR_REGEX = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g;

/** Extract GitHub PR URLs from text. Returns deduplicated URLs. */
export function extractPrUrls(text: string): string[] {
	const matches = text.match(GITHUB_PR_REGEX);
	if (!matches) return [];
	return [...new Set(matches)];
}

// ============================================
// Telemetry Flush Types
// ============================================

export interface TelemetryDelta {
	toolCalls: number;
	messagesExchanged: number;
	activeSeconds: number;
}

export interface TelemetryFlushPayload {
	delta: TelemetryDelta;
	newPrUrls: string[];
	latestTask: string | null;
	/** @internal Snapshot of tool call IDs for differential markFlushed */
	_toolCallIds?: Set<string>;
	/** @internal Snapshot of messages count for differential markFlushed */
	_messagesExchanged?: number;
}

export type FlushFn = (
	sessionId: string,
	delta: TelemetryDelta,
	newPrUrls: string[],
	latestTask: string | null,
) => Promise<void>;

// ============================================
// SessionTelemetry
// ============================================

export class SessionTelemetry {
	private readonly sessionId: string;

	// Counters (reset after each flush)
	private toolCallIds = new Set<string>();
	private deltaMessages = 0;
	private deltaPrUrls: string[] = [];
	private deltaActiveSeconds = 0;

	// Dedup across session lifetime
	private allPrUrls = new Set<string>();

	// Latest task (dirty-tracked)
	private latestTask: string | null = null;
	private latestTaskDirty = false;

	// Active time tracking (timestamp delta approach)
	private runningStartedAt: number | null = null;

	// Single-flight flush mutex
	private flushInProgress: Promise<void> | null = null;
	private flushQueued = false;

	constructor(sessionId: string) {
		this.sessionId = sessionId;
	}

	// ============================================
	// Counting hooks
	// ============================================

	recordToolCall(toolCallId: string): void {
		this.toolCallIds.add(toolCallId);
	}

	recordMessageComplete(): void {
		this.deltaMessages++;
	}

	recordUserPrompt(): void {
		this.deltaMessages++;
	}

	recordPrUrl(url: string): void {
		if (!this.allPrUrls.has(url)) {
			this.allPrUrls.add(url);
			this.deltaPrUrls.push(url);
		}
	}

	updateLatestTask(title: string): void {
		if (this.latestTask !== title) {
			this.latestTask = title;
			this.latestTaskDirty = true;
		}
	}

	// ============================================
	// Lifecycle (idempotent)
	// ============================================

	startRunning(): void {
		if (this.runningStartedAt === null) {
			this.runningStartedAt = Date.now();
		}
	}

	stopRunning(): void {
		if (this.runningStartedAt !== null) {
			const elapsed = Math.floor((Date.now() - this.runningStartedAt) / 1000);
			this.deltaActiveSeconds += elapsed;
			this.runningStartedAt = null;
		}
	}

	// ============================================
	// Flush (single-flight mutex)
	// ============================================

	async flush(flushFn: FlushFn): Promise<void> {
		if (this.flushInProgress) {
			// Queue exactly one rerun
			this.flushQueued = true;
			await this.flushInProgress;
			return;
		}

		this.flushInProgress = this.doFlush(flushFn);
		try {
			await this.flushInProgress;
		} finally {
			this.flushInProgress = null;
		}

		// Run queued flush if any
		if (this.flushQueued) {
			this.flushQueued = false;
			await this.flush(flushFn);
		}
	}

	private async doFlush(flushFn: FlushFn): Promise<void> {
		const payload = this.getFlushPayload();
		if (!payload) return;

		await flushFn(this.sessionId, payload.delta, payload.newPrUrls, payload.latestTask);
		this.markFlushed(payload);
	}

	/** Returns flush payload, or null if nothing is dirty. Internal to flush mutex. */
	getFlushPayload(): TelemetryFlushPayload | null {
		// Accumulate any in-flight active time (without stopping)
		let activeSeconds = this.deltaActiveSeconds;
		if (this.runningStartedAt !== null) {
			activeSeconds += Math.floor((Date.now() - this.runningStartedAt) / 1000);
		}

		// Snapshot tool call IDs so markFlushed can remove only these
		const toolCallIdsSnapshot = new Set(this.toolCallIds);

		const delta: TelemetryDelta = {
			toolCalls: toolCallIdsSnapshot.size,
			messagesExchanged: this.deltaMessages,
			activeSeconds,
		};

		const prUrlsSnapshot = [...this.deltaPrUrls];
		const hasDelta = delta.toolCalls > 0 || delta.messagesExchanged > 0 || delta.activeSeconds > 0;
		const hasPrUrls = prUrlsSnapshot.length > 0;
		const hasTask = this.latestTaskDirty;

		if (!hasDelta && !hasPrUrls && !hasTask) return null;

		return {
			delta,
			newPrUrls: prUrlsSnapshot,
			latestTask: this.latestTask,
			// Internal snapshot for markFlushed
			_toolCallIds: toolCallIdsSnapshot,
			_messagesExchanged: this.deltaMessages,
		};
	}

	/**
	 * Subtract only the captured snapshot from deltas (not data added during flush).
	 * Internal to flush mutex.
	 */
	markFlushed(payload?: TelemetryFlushPayload | null): void {
		if (payload?._toolCallIds) {
			for (const id of payload._toolCallIds) {
				this.toolCallIds.delete(id);
			}
		} else {
			this.toolCallIds.clear();
		}

		this.deltaMessages -= payload?._messagesExchanged ?? this.deltaMessages;
		this.deltaPrUrls = this.deltaPrUrls.filter((url) => !payload?.newPrUrls.includes(url));
		this.deltaActiveSeconds = 0;
		this.latestTaskDirty = false;

		// Reset runningStartedAt to now (not null) to avoid double-counting
		// active time that was flushed. Session is still running.
		if (this.runningStartedAt !== null) {
			this.runningStartedAt = Date.now();
		}
	}
}
