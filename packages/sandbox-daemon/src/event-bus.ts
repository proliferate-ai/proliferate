/**
 * Event bus — multiplexed event stream with sequence numbers.
 *
 * All daemon subsystems emit events through this bus.
 * The /_proliferate/events SSE endpoint reads from it.
 * Uses the RuntimeDaemonEvent envelope from @proliferate/shared.
 */

import type { RuntimeDaemonEvent } from "@proliferate/shared/contracts";

// ---------------------------------------------------------------------------
// Unified daemon event envelope (extends RuntimeDaemonEvent with seq/ts)
// ---------------------------------------------------------------------------

export interface DaemonStreamEvent {
	v: "1";
	stream: "pty_out" | "fs_change" | "agent_event" | "port_opened" | "port_closed" | "sys_event";
	seq: number;
	event: "data" | "close" | "error";
	payload: unknown;
	ts: number;
}

// ---------------------------------------------------------------------------
// Subscriber
// ---------------------------------------------------------------------------

export type EventSubscriber = (event: DaemonStreamEvent) => void;

// ---------------------------------------------------------------------------
// Event Bus
// ---------------------------------------------------------------------------

export class EventBus {
	private seq = 0;
	private subscribers = new Set<EventSubscriber>();

	subscribe(fn: EventSubscriber): () => void {
		this.subscribers.add(fn);
		return () => {
			this.subscribers.delete(fn);
		};
	}

	/**
	 * Emit a raw daemon stream event to all subscribers.
	 */
	emit(
		stream: DaemonStreamEvent["stream"],
		eventType: DaemonStreamEvent["event"],
		payload: unknown,
	): DaemonStreamEvent {
		this.seq++;
		const event: DaemonStreamEvent = {
			v: "1",
			stream,
			seq: this.seq,
			event: eventType,
			payload,
			ts: Date.now(),
		};
		for (const sub of this.subscribers) {
			try {
				sub(event);
			} catch {
				// Subscriber errors must not break the bus
			}
		}
		return event;
	}

	/**
	 * Emit a RuntimeDaemonEvent (from the OpenCode bridge) as an agent_event.
	 */
	emitAgentEvent(daemonEvent: RuntimeDaemonEvent): DaemonStreamEvent {
		return this.emit("agent_event", "data", daemonEvent);
	}

	/**
	 * Emit a system event (health, lifecycle, errors).
	 */
	emitSystemEvent(payload: Record<string, unknown>): DaemonStreamEvent {
		return this.emit("sys_event", "data", payload);
	}

	getSeq(): number {
		return this.seq;
	}
}
