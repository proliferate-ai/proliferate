import { describe, expect, it, vi } from "vitest";
import { type FlushFn, SessionTelemetry, extractPrUrls } from "./session-telemetry";

// ============================================
// extractPrUrls
// ============================================

describe("extractPrUrls", () => {
	it("extracts GitHub PR URLs from text", () => {
		const text = "Created PR: https://github.com/acme/repo/pull/42";
		expect(extractPrUrls(text)).toEqual(["https://github.com/acme/repo/pull/42"]);
	});

	it("handles multiple URLs in one string", () => {
		const text = "See https://github.com/a/b/pull/1 and https://github.com/c/d/pull/2 for details";
		expect(extractPrUrls(text)).toEqual([
			"https://github.com/a/b/pull/1",
			"https://github.com/c/d/pull/2",
		]);
	});

	it("deduplicates identical URLs", () => {
		const text = "https://github.com/a/b/pull/1 mentioned twice: https://github.com/a/b/pull/1";
		expect(extractPrUrls(text)).toEqual(["https://github.com/a/b/pull/1"]);
	});

	it("ignores non-PR GitHub URLs", () => {
		const text = [
			"https://github.com/a/b/issues/1",
			"https://github.com/a/b/commit/abc",
			"https://github.com/a/b/blob/main/file.ts",
		].join(" ");
		expect(extractPrUrls(text)).toEqual([]);
	});

	it("returns empty array for no matches", () => {
		expect(extractPrUrls("no urls here")).toEqual([]);
		expect(extractPrUrls("")).toEqual([]);
	});

	it("handles URLs with org/repo containing dots and dashes", () => {
		const text = "https://github.com/my-org.io/my-repo.js/pull/123";
		expect(extractPrUrls(text)).toEqual(["https://github.com/my-org.io/my-repo.js/pull/123"]);
	});
});

// ============================================
// SessionTelemetry
// ============================================

describe("SessionTelemetry", () => {
	function createTelemetry() {
		return new SessionTelemetry("test-session-id");
	}

	function createFlushFn(): FlushFn & { calls: Parameters<FlushFn>[] } {
		const calls: Parameters<FlushFn>[] = [];
		const fn = async (...args: Parameters<FlushFn>) => {
			calls.push(args);
		};
		(fn as FlushFn & { calls: Parameters<FlushFn>[] }).calls = calls;
		return fn as FlushFn & { calls: Parameters<FlushFn>[] };
	}

	describe("recordToolCall", () => {
		it("deduplicates by toolCallId", () => {
			const t = createTelemetry();
			t.recordToolCall("tc-1");
			t.recordToolCall("tc-1");
			t.recordToolCall("tc-2");
			const payload = t.getFlushPayload();
			expect(payload?.delta.toolCalls).toBe(2);
		});
	});

	describe("recordMessageComplete / recordUserPrompt", () => {
		it("both increment deltaMessages", () => {
			const t = createTelemetry();
			t.recordMessageComplete();
			t.recordUserPrompt();
			t.recordMessageComplete();
			const payload = t.getFlushPayload();
			expect(payload?.delta.messagesExchanged).toBe(3);
		});
	});

	describe("recordPrUrl", () => {
		it("deduplicates URLs", () => {
			const t = createTelemetry();
			t.recordPrUrl("https://github.com/a/b/pull/1");
			t.recordPrUrl("https://github.com/a/b/pull/1");
			t.recordPrUrl("https://github.com/a/b/pull/2");
			const payload = t.getFlushPayload();
			expect(payload?.newPrUrls).toEqual([
				"https://github.com/a/b/pull/1",
				"https://github.com/a/b/pull/2",
			]);
		});
	});

	describe("startRunning / stopRunning", () => {
		it("startRunning is idempotent", () => {
			const t = createTelemetry();
			vi.useFakeTimers();

			t.startRunning();
			vi.advanceTimersByTime(5000);
			t.startRunning(); // should NOT reset runningStartedAt
			vi.advanceTimersByTime(5000);
			t.stopRunning();

			const payload = t.getFlushPayload();
			expect(payload?.delta.activeSeconds).toBe(10);

			vi.useRealTimers();
		});

		it("accumulates activeSeconds correctly", () => {
			const t = createTelemetry();
			vi.useFakeTimers();

			t.startRunning();
			vi.advanceTimersByTime(3000);
			t.stopRunning();

			t.startRunning();
			vi.advanceTimersByTime(7000);
			t.stopRunning();

			const payload = t.getFlushPayload();
			expect(payload?.delta.activeSeconds).toBe(10);

			vi.useRealTimers();
		});
	});

	describe("getFlushPayload", () => {
		it("returns null when nothing is dirty", () => {
			const t = createTelemetry();
			expect(t.getFlushPayload()).toBeNull();
		});

		it("includes latestTask when dirty", () => {
			const t = createTelemetry();
			t.updateLatestTask("Analyzing code");
			const payload = t.getFlushPayload();
			expect(payload?.latestTask).toBe("Analyzing code");
		});

		it("includes in-flight active time without stopping", () => {
			const t = createTelemetry();
			vi.useFakeTimers();

			t.startRunning();
			vi.advanceTimersByTime(5000);

			const payload = t.getFlushPayload();
			expect(payload?.delta.activeSeconds).toBe(5);

			vi.useRealTimers();
		});
	});

	describe("markFlushed (via flush)", () => {
		it("resets deltas but keeps allPrUrls dedup set", async () => {
			const t = createTelemetry();
			const flushFn = createFlushFn();

			t.recordToolCall("tc-1");
			t.recordMessageComplete();
			t.recordPrUrl("https://github.com/a/b/pull/1");
			t.updateLatestTask("Task A");

			await t.flush(flushFn);

			// Deltas should be reset
			expect(t.getFlushPayload()).toBeNull();

			// allPrUrls dedup should persist
			t.recordPrUrl("https://github.com/a/b/pull/1"); // same URL
			expect(t.getFlushPayload()).toBeNull(); // no new data

			t.recordPrUrl("https://github.com/a/b/pull/2"); // new URL
			const payload = t.getFlushPayload();
			expect(payload?.newPrUrls).toEqual(["https://github.com/a/b/pull/2"]);
		});

		it("resets runningStartedAt to now if still running", async () => {
			const t = createTelemetry();
			const flushFn = createFlushFn();
			vi.useFakeTimers();

			t.startRunning();
			vi.advanceTimersByTime(5000);
			await t.flush(flushFn);

			// After flushing, active time should restart from now
			vi.advanceTimersByTime(3000);
			const payload = t.getFlushPayload();
			expect(payload?.delta.activeSeconds).toBe(3);

			vi.useRealTimers();
		});
	});

	describe("flush (single-flight mutex)", () => {
		it("flushes to DB function with correct sessionId", async () => {
			const t = createTelemetry();
			t.recordToolCall("tc-1");
			t.recordMessageComplete();

			const flushFn = createFlushFn();
			await t.flush(flushFn);

			expect(flushFn.calls).toHaveLength(1);
			expect(flushFn.calls[0][0]).toBe("test-session-id");
			expect(flushFn.calls[0][1].toolCalls).toBe(1);
			expect(flushFn.calls[0][1].messagesExchanged).toBe(1);
		});

		it("skips flush when nothing is dirty", async () => {
			const t = createTelemetry();
			const flushFn = createFlushFn();
			await t.flush(flushFn);
			expect(flushFn.calls).toHaveLength(0);
		});

		it("concurrent flush calls coalesce (no double-count)", async () => {
			const t = createTelemetry();
			t.recordToolCall("tc-1");

			let resolveFirst: () => void;
			const firstFlushPromise = new Promise<void>((resolve) => {
				resolveFirst = resolve;
			});

			const calls: string[] = [];
			const flushFn: FlushFn = async (_sessionId, delta) => {
				calls.push(`toolCalls:${delta.toolCalls}`);
				if (calls.length === 1) {
					// First call: block until we release
					await firstFlushPromise;
				}
			};

			// Start first flush (will block)
			const flush1 = t.flush(flushFn);

			// Add more data while first flush is in progress
			t.recordToolCall("tc-2");

			// Start second flush (should queue)
			const flush2 = t.flush(flushFn);

			// Release first flush
			resolveFirst!();

			await Promise.all([flush1, flush2]);

			// Should have 2 calls: first with 1 tool call, second (queued rerun) with 1 new tool call
			expect(calls).toEqual(["toolCalls:1", "toolCalls:1"]);
		});

		it("multiple flush cycles accumulate correctly", async () => {
			const t = createTelemetry();
			const flushFn = createFlushFn();

			t.recordToolCall("tc-1");
			t.recordMessageComplete();
			await t.flush(flushFn);

			t.recordToolCall("tc-2");
			t.recordToolCall("tc-3");
			t.recordUserPrompt();
			await t.flush(flushFn);

			expect(flushFn.calls).toHaveLength(2);
			expect(flushFn.calls[0][1]).toEqual({
				toolCalls: 1,
				messagesExchanged: 1,
				activeSeconds: 0,
			});
			expect(flushFn.calls[1][1]).toEqual({
				toolCalls: 2,
				messagesExchanged: 1,
				activeSeconds: 0,
			});
		});
	});
});
