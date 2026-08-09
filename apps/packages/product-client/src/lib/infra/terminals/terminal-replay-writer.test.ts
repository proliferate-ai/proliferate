import { describe, expect, it, vi } from "vitest";
import {
  createTerminalReplayWriter,
} from "#product/lib/infra/terminals/terminal-replay-writer";
import type { TerminalReplayEntry } from "#product/lib/infra/terminals/terminal-replay-buffer";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("terminal replay writer", () => {
  it("coalesces ordered stream bursts into one xterm write per frame", () => {
    const terminal = { write: vi.fn() };
    const scheduler = createTestScheduler();
    const onFlush = vi.fn();
    const writer = createTerminalReplayWriter(terminal, scheduler, onFlush);

    writer.enqueue(dataEntry(1, "one"));
    writer.enqueue(dataEntry(2, "two"));
    writer.enqueue({
      type: "runtime-gap",
      order: 3,
      requestedAfterSeq: 2,
      floorSeq: 4,
    });
    writer.enqueue(dataEntry(4, "four"));

    expect(scheduler.request).toHaveBeenCalledTimes(1);
    expect(terminal.write).not.toHaveBeenCalled();

    scheduler.flush();

    expect(terminal.write).toHaveBeenCalledTimes(1);
    expect(decoder.decode(terminal.write.mock.calls[0]?.[0])).toBe(
      "onetwo\r\n[terminal output gap: earlier output was discarded]\r\nfour",
    );
    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush.mock.calls[0]?.[0]).toHaveLength(4);
  });

  it("cancels queued work when its viewport is hidden or disposed", () => {
    const terminal = { write: vi.fn() };
    const scheduler = createTestScheduler();
    const writer = createTerminalReplayWriter(terminal, scheduler);
    writer.enqueue(dataEntry(1, "discarded"));

    writer.dispose();
    scheduler.flush();

    expect(scheduler.cancel).toHaveBeenCalledTimes(1);
    expect(terminal.write).not.toHaveBeenCalled();
  });

  it("bounds entry backlog while animation frames are stalled", () => {
    const terminal = { write: vi.fn() };
    const scheduler = createTestScheduler();
    const onFlush = vi.fn();
    const writer = createTerminalReplayWriter(terminal, scheduler, onFlush);

    for (let order = 1; order <= 1_010; order += 1) {
      writer.enqueue(dataEntry(order, "."));
    }
    expect(scheduler.request).toHaveBeenCalledTimes(1);

    scheduler.flush();

    const flushedEntries = onFlush.mock.calls[0]?.[0] as TerminalReplayEntry[];
    expect(flushedEntries[0]?.type).toBe("local-overflow");
    expect(flushedEntries.filter((entry) => entry.type === "data")).toHaveLength(1_000);
    expect(flushedEntries[1]?.order).toBe(11);
    expect(flushedEntries.at(-1)?.order).toBe(1_010);
    expect(decoder.decode(terminal.write.mock.calls[0]?.[0])).toMatch(
      /^\r\n\[terminal output gap: earlier output was discarded\]\r\n\.{1000}$/,
    );
  });

  it("bounds byte backlog while animation frames are stalled", () => {
    const terminal = { write: vi.fn() };
    const scheduler = createTestScheduler();
    const onFlush = vi.fn();
    const writer = createTerminalReplayWriter(terminal, scheduler, onFlush);
    const largeChunk = new Uint8Array(200 * 1024).fill("x".charCodeAt(0));

    writer.enqueue({ type: "data", order: 1, seq: 1, data: largeChunk });
    writer.enqueue({ type: "data", order: 2, seq: 2, data: largeChunk });
    scheduler.flush();

    const flushedEntries = onFlush.mock.calls[0]?.[0] as TerminalReplayEntry[];
    expect(flushedEntries.map((entry) => entry.type)).toEqual(["local-overflow", "data"]);
    expect(flushedEntries[1]?.order).toBe(2);
    expect(terminal.write.mock.calls[0]?.[0].byteLength).toBeLessThan(256 * 1024);
  });
});

function dataEntry(order: number, value: string): TerminalReplayEntry {
  return {
    type: "data",
    order,
    seq: order,
    data: encoder.encode(value),
  };
}

function createTestScheduler() {
  let callback: FrameRequestCallback | null = null;
  return {
    request: vi.fn((next: FrameRequestCallback) => {
      callback = next;
      return 1;
    }),
    cancel: vi.fn(() => {
      callback = null;
    }),
    flush() {
      const next = callback;
      callback = null;
      next?.(0);
    },
  };
}
