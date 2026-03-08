import type { RuntimeDaemonEvent } from "../../../harness/contracts/coding";

const MAX_SOURCE_EVENT_KEYS = 10_000;

export interface EventSequencerResult {
	accepted: boolean;
	reason?: "stale_binding" | "duplicate";
	eventSeq?: number;
}

/**
 * Canonical event sequencer: assigns monotonic eventSeq,
 * fences stale bindings, and deduplicates by sourceEventKey.
 *
 * Extracted from SessionHub for testability.
 */
export class EventSequencer {
	private seq = 0;
	private activeBindingId: string | null = null;
	private readonly seenKeys = new Set<string>();
	private readonly keyOrder: string[] = [];

	/**
	 * Process an incoming runtime event.
	 * Returns whether the event was accepted plus the assigned sequence number.
	 *
	 * Side-effects: mutates event.bindingId, event.sourceEventKey, event.eventSeq
	 * when accepted.
	 */
	process(event: RuntimeDaemonEvent, currentBindingId: string | null): EventSequencerResult {
		// Sync binding state
		if (currentBindingId !== this.activeBindingId) {
			this.resetBinding(currentBindingId);
		}

		// Stale binding fence
		const resolvedBindingId = event.bindingId ?? currentBindingId;
		if (currentBindingId && resolvedBindingId && resolvedBindingId !== currentBindingId) {
			return { accepted: false, reason: "stale_binding" };
		}

		if (resolvedBindingId) {
			event.bindingId = resolvedBindingId;
		}

		// Dedupe by sourceEventKey
		const sourceEventKey =
			event.sourceEventKey ??
			`${resolvedBindingId ?? "legacy"}:${event.sourceSeq ?? "na"}:${event.type}:${event.occurredAt}`;
		if (this.seenKeys.has(sourceEventKey)) {
			return { accepted: false, reason: "duplicate" };
		}

		event.sourceEventKey = sourceEventKey;
		this.rememberKey(sourceEventKey);

		// Assign monotonic sequence
		event.eventSeq = ++this.seq;

		return { accepted: true, eventSeq: event.eventSeq };
	}

	getSeq(): number {
		return this.seq;
	}

	getActiveBindingId(): string | null {
		return this.activeBindingId;
	}

	getSeenKeyCount(): number {
		return this.seenKeys.size;
	}

	private resetBinding(bindingId: string | null): void {
		this.activeBindingId = bindingId;
		this.seenKeys.clear();
		this.keyOrder.length = 0;
	}

	private rememberKey(key: string): void {
		this.seenKeys.add(key);
		this.keyOrder.push(key);
		if (this.keyOrder.length > MAX_SOURCE_EVENT_KEYS) {
			const oldest = this.keyOrder.shift();
			if (oldest) {
				this.seenKeys.delete(oldest);
			}
		}
	}
}
