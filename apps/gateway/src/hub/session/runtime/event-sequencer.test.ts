import { describe, expect, it } from "vitest";
import type { RuntimeDaemonEvent } from "../../../harness/contracts/coding";
import { EventSequencer } from "./event-sequencer";

function makeEvent(overrides: Partial<RuntimeDaemonEvent> = {}): RuntimeDaemonEvent {
	return {
		source: "daemon",
		channel: "message",
		type: "message.updated",
		isTerminal: false,
		occurredAt: new Date().toISOString(),
		payload: {},
		...overrides,
	};
}

describe("EventSequencer", () => {
	describe("monotonic sequencing", () => {
		it("assigns monotonically increasing eventSeq", () => {
			const seq = new EventSequencer();
			const e1 = makeEvent({ sourceEventKey: "k1" });
			const e2 = makeEvent({ sourceEventKey: "k2" });
			const e3 = makeEvent({ sourceEventKey: "k3" });

			const r1 = seq.process(e1, "binding-1");
			const r2 = seq.process(e2, "binding-1");
			const r3 = seq.process(e3, "binding-1");

			expect(r1.accepted).toBe(true);
			expect(r2.accepted).toBe(true);
			expect(r3.accepted).toBe(true);
			expect(e1.eventSeq).toBe(1);
			expect(e2.eventSeq).toBe(2);
			expect(e3.eventSeq).toBe(3);
		});

		it("sequence persists across binding changes", () => {
			const seq = new EventSequencer();
			seq.process(makeEvent({ sourceEventKey: "k1" }), "binding-1");
			seq.process(makeEvent({ sourceEventKey: "k2" }), "binding-1");
			const e3 = makeEvent({ sourceEventKey: "k3" });
			seq.process(e3, "binding-2");
			expect(e3.eventSeq).toBe(3);
		});
	});

	describe("stale binding fencing", () => {
		it("drops events from a superseded binding", () => {
			const seq = new EventSequencer();
			seq.process(makeEvent({ sourceEventKey: "k1" }), "binding-1");

			// Simulate binding change
			seq.process(makeEvent({ sourceEventKey: "k2" }), "binding-2");

			// Event arrives with old binding
			const stale = makeEvent({ bindingId: "binding-1", sourceEventKey: "k3" });
			const result = seq.process(stale, "binding-2");

			expect(result.accepted).toBe(false);
			expect(result.reason).toBe("stale_binding");
		});

		it("accepts events matching the current binding", () => {
			const seq = new EventSequencer();
			const e = makeEvent({ bindingId: "binding-1", sourceEventKey: "k1" });
			const result = seq.process(e, "binding-1");
			expect(result.accepted).toBe(true);
		});

		it("accepts events without bindingId when current binding is set", () => {
			const seq = new EventSequencer();
			const e = makeEvent({ sourceEventKey: "k1" });
			const result = seq.process(e, "binding-1");
			expect(result.accepted).toBe(true);
			expect(e.bindingId).toBe("binding-1");
		});

		it("resets dedupe state on binding change", () => {
			const seq = new EventSequencer();
			const e1 = makeEvent({ sourceEventKey: "k1" });
			seq.process(e1, "binding-1");

			// Same key under new binding should be accepted (dedupe state cleared)
			const e2 = makeEvent({ sourceEventKey: "k1" });
			const result = seq.process(e2, "binding-2");
			expect(result.accepted).toBe(true);
		});
	});

	describe("deduplication by sourceEventKey", () => {
		it("drops duplicate sourceEventKey", () => {
			const seq = new EventSequencer();
			const e1 = makeEvent({ sourceEventKey: "k1" });
			const e2 = makeEvent({ sourceEventKey: "k1" });

			const r1 = seq.process(e1, "binding-1");
			const r2 = seq.process(e2, "binding-1");

			expect(r1.accepted).toBe(true);
			expect(r2.accepted).toBe(false);
			expect(r2.reason).toBe("duplicate");
		});

		it("synthesizes sourceEventKey when event has none", () => {
			const seq = new EventSequencer();
			const e1 = makeEvent({
				sourceSeq: 5,
				type: "message.updated",
				occurredAt: "2026-01-01T00:00:00.000Z",
			});
			seq.process(e1, "binding-1");

			expect(e1.sourceEventKey).toBe("binding-1:5:message.updated:2026-01-01T00:00:00.000Z");
		});

		it("evicts oldest keys when exceeding capacity", () => {
			const seq = new EventSequencer();
			// Fill up to capacity
			for (let i = 0; i < 10_001; i++) {
				seq.process(makeEvent({ sourceEventKey: `k${i}` }), "binding-1");
			}

			// k0 should have been evicted, so re-sending it should be accepted
			const reused = makeEvent({ sourceEventKey: "k0" });
			const result = seq.process(reused, "binding-1");
			expect(result.accepted).toBe(true);

			// k10000 should still be remembered
			const dup = makeEvent({ sourceEventKey: "k10000" });
			const dupResult = seq.process(dup, "binding-1");
			expect(dupResult.accepted).toBe(false);
			expect(dupResult.reason).toBe("duplicate");
		});
	});

	describe("one-active-run semantics (input rejection)", () => {
		it("does not interfere with event acceptance (run tracking is hub-level)", () => {
			const seq = new EventSequencer();
			const e1 = makeEvent({ sourceEventKey: "k1", type: "session.idle" });
			const e2 = makeEvent({ sourceEventKey: "k2", type: "message.updated" });

			expect(seq.process(e1, "binding-1").accepted).toBe(true);
			expect(seq.process(e2, "binding-1").accepted).toBe(true);
		});
	});

	describe("event mutation", () => {
		it("stamps bindingId on accepted events", () => {
			const seq = new EventSequencer();
			const e = makeEvent({ sourceEventKey: "k1" });
			seq.process(e, "binding-1");
			expect(e.bindingId).toBe("binding-1");
		});

		it("stamps eventSeq on accepted events", () => {
			const seq = new EventSequencer();
			const e = makeEvent({ sourceEventKey: "k1" });
			seq.process(e, "binding-1");
			expect(e.eventSeq).toBe(1);
		});

		it("does not mutate rejected events", () => {
			const seq = new EventSequencer();
			seq.process(makeEvent({ sourceEventKey: "k1" }), "binding-1");

			const dup = makeEvent({ sourceEventKey: "k1" });
			seq.process(dup, "binding-1");
			expect(dup.eventSeq).toBeUndefined();
		});
	});
});
