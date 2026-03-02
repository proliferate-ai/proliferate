import { describe, expect, it } from "vitest";
import { EventBus } from "../event-bus.js";
import { PtyTransport } from "../pty.js";

function createTestLogger(): any {
	const noop = () => undefined;
	return { child: () => createTestLogger(), info: noop, debug: noop, warn: noop, error: noop };
}

describe("PtyTransport", () => {
	it("registers and lists processes", () => {
		const bus = new EventBus();
		const pty = new PtyTransport({ eventBus: bus, logger: createTestLogger() });

		pty.ensureProcess("proc-1");
		pty.ensureProcess("proc-2");

		const list = pty.listProcesses();
		expect(list).toHaveLength(2);
		expect(list.map((p) => p.id)).toContain("proc-1");
		expect(list.map((p) => p.id)).toContain("proc-2");
	});

	it("writes output and emits events", () => {
		const bus = new EventBus();
		const events: unknown[] = [];
		bus.subscribe((e) => events.push(e));

		const pty = new PtyTransport({ eventBus: bus, logger: createTestLogger() });
		pty.writeOutput("proc-1", "line 1\nline 2\n");

		expect(events.length).toBeGreaterThanOrEqual(2);
		const first = events[0] as { stream: string; payload: { data: string } };
		expect(first.stream).toBe("pty_out");
		expect(first.payload.data).toBe("line 1");
	});

	it("replays output since a given sequence", () => {
		const bus = new EventBus();
		const pty = new PtyTransport({ eventBus: bus, logger: createTestLogger() });

		pty.writeOutput("proc-1", "a\nb\nc\n");

		const all = pty.replay("proc-1", 0);
		expect(all).toHaveLength(3);

		const sinceSeq1 = pty.replay("proc-1", 1);
		expect(sinceSeq1).toHaveLength(2);

		const latest = pty.getLatestSeq("proc-1");
		expect(latest).toBe(3);
	});

	it("truncates lines exceeding max length", () => {
		const bus = new EventBus();
		const pty = new PtyTransport({ eventBus: bus, logger: createTestLogger() });

		const longLine = "x".repeat(20_000);
		pty.writeOutput("proc-1", longLine);

		const lines = pty.replay("proc-1", 0);
		expect(lines).toHaveLength(1);
		expect(lines[0].data.length).toBe(16384); // 16 KB
	});

	it("evicts old lines when exceeding max count", () => {
		const bus = new EventBus();
		const pty = new PtyTransport({ eventBus: bus, logger: createTestLogger() });

		// Write more than 10000 lines
		for (let i = 0; i < 10_050; i++) {
			pty.writeOutput("proc-1", `line ${i}`);
		}

		const lines = pty.replay("proc-1", 0);
		expect(lines.length).toBeLessThanOrEqual(10_000);
	});

	it("returns empty for unknown process", () => {
		const bus = new EventBus();
		const pty = new PtyTransport({ eventBus: bus, logger: createTestLogger() });

		expect(pty.replay("unknown", 0)).toEqual([]);
		expect(pty.getLatestSeq("unknown")).toBe(0);
	});

	it("clearAll removes all processes and buffers", () => {
		const bus = new EventBus();
		const pty = new PtyTransport({ eventBus: bus, logger: createTestLogger() });

		pty.writeOutput("proc-1", "data");
		pty.writeOutput("proc-2", "data");
		expect(pty.listProcesses()).toHaveLength(2);

		pty.clearAll();
		expect(pty.listProcesses()).toHaveLength(0);
	});
});
