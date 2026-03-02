import { describe, expect, it } from "vitest";
import { EventBus } from "../event-bus.js";

describe("EventBus", () => {
	it("emits events with incrementing sequence numbers", () => {
		const bus = new EventBus();
		const events: unknown[] = [];
		bus.subscribe((e) => events.push(e));

		bus.emit("pty_out", "data", { text: "hello" });
		bus.emit("fs_change", "data", { action: "write" });

		expect(events).toHaveLength(2);
		expect((events[0] as { seq: number }).seq).toBe(1);
		expect((events[1] as { seq: number }).seq).toBe(2);
	});

	it("includes version, stream, and timestamp", () => {
		const bus = new EventBus();
		const events: unknown[] = [];
		bus.subscribe((e) => events.push(e));

		bus.emit("port_opened", "data", { port: 3000 });

		const event = events[0] as { v: string; stream: string; ts: number };
		expect(event.v).toBe("1");
		expect(event.stream).toBe("port_opened");
		expect(typeof event.ts).toBe("number");
	});

	it("unsubscribe removes listener", () => {
		const bus = new EventBus();
		const events: unknown[] = [];
		const unsub = bus.subscribe((e) => events.push(e));

		bus.emit("sys_event", "data", {});
		unsub();
		bus.emit("sys_event", "data", {});

		expect(events).toHaveLength(1);
	});

	it("emitAgentEvent wraps as agent_event stream", () => {
		const bus = new EventBus();
		const events: unknown[] = [];
		bus.subscribe((e) => events.push(e));

		bus.emitAgentEvent({
			source: "daemon",
			channel: "message",
			type: "message.updated",
			isTerminal: false,
			occurredAt: new Date().toISOString(),
			payload: {},
		});

		const event = events[0] as { stream: string };
		expect(event.stream).toBe("agent_event");
	});

	it("subscriber errors do not break other subscribers", () => {
		const bus = new EventBus();
		const events: unknown[] = [];
		bus.subscribe(() => {
			throw new Error("boom");
		});
		bus.subscribe((e) => events.push(e));

		bus.emit("sys_event", "data", {});
		expect(events).toHaveLength(1);
	});

	it("getSeq tracks current sequence", () => {
		const bus = new EventBus();
		expect(bus.getSeq()).toBe(0);

		bus.emit("sys_event", "data", {});
		expect(bus.getSeq()).toBe(1);

		bus.emit("sys_event", "data", {});
		expect(bus.getSeq()).toBe(2);
	});
});
