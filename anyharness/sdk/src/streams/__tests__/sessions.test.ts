import { afterEach, describe, expect, it, vi } from "vitest";
import {
  setAnyHarnessTimingObserver,
  type AnyHarnessTimingEvent,
} from "../../client/core.js";
import { streamSession } from "../../streams/sessions.js";
import type { SessionEventEnvelope } from "../../types/events.js";

const originalFetch = globalThis.fetch;

describe("streamSession", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    setAnyHarnessTimingObserver(null);
  });

  it("parses multi-line SSE payloads into one envelope", async () => {
    const events: SessionEventEnvelope[] = [];
    const opened = vi.fn();
    const closed = vi.fn();

    globalThis.fetch = vi.fn(async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`event: turn_started\ndata: {"sessionId":"s1",\n`));
            controller.enqueue(encoder.encode(`data: "seq":1,"timestamp":"2026-04-04T00:00:01Z","event":{"type":"turn_started"}}\n\n`));
            controller.close();
          },
        }),
        { status: 200 },
      )) as typeof fetch;

    await new Promise<void>((resolve, reject) => {
      streamSession({
        baseUrl: "http://runtime.test",
        sessionId: "s1",
        onEvent: (event) => {
          events.push(event);
        },
        onOpen: opened,
        onClose: () => {
          closed();
          resolve();
        },
        onError: reject,
      });
    });

    expect(opened).toHaveBeenCalledOnce();
    expect(closed).toHaveBeenCalledOnce();
    expect(events).toEqual([
      {
        sessionId: "s1",
        seq: 1,
        timestamp: "2026-04-04T00:00:01Z",
        event: { type: "turn_started" },
      },
    ]);
  });

  it("ignores malformed payloads without breaking subsequent events", async () => {
    const events: SessionEventEnvelope[] = [];

    globalThis.fetch = vi.fn(async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`data: {"nope":\n\n`));
            controller.enqueue(encoder.encode(`: keepalive\n`));
            controller.enqueue(encoder.encode(`data: {"sessionId":"s1","seq":2,"timestamp":"2026-04-04T00:00:02Z","event":{"type":"turn_ended","stopReason":"end_turn"}}\n\n`));
            controller.close();
          },
        }),
        { status: 200 },
      )) as typeof fetch;

    await new Promise<void>((resolve, reject) => {
      streamSession({
        baseUrl: "http://runtime.test",
        sessionId: "s1",
        onEvent: (event) => {
          events.push(event);
        },
        onClose: resolve,
        onError: reject,
      });
    });

    expect(events).toEqual([
      {
        sessionId: "s1",
        seq: 2,
        timestamp: "2026-04-04T00:00:02Z",
        event: { type: "turn_ended", stopReason: "end_turn" },
      },
    ]);
  });

  it("forwards custom headers alongside the auth token", async () => {
    globalThis.fetch = vi.fn(async (_input, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("accept")).toBe("text/event-stream");
      expect(headers.get("authorization")).toBe("Bearer secret-token");
      expect(headers.get("x-anyharness-flow-id")).toBe("flow-123");
      expect(headers.get("x-anyharness-flow-kind")).toBe("session_switch");

      return new Response(
        new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    await new Promise<void>((resolve, reject) => {
      streamSession({
        baseUrl: "http://runtime.test",
        sessionId: "s1",
        authToken: "secret-token",
        headers: {
          "x-anyharness-flow-id": "flow-123",
          "x-anyharness-flow-kind": "session_switch",
        },
        onEvent: () => undefined,
        onClose: resolve,
        onError: reject,
      });
    });

    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it("emits sanitized stream timing events", async () => {
    const timingEvents: AnyHarnessTimingEvent[] = [];
    setAnyHarnessTimingObserver((event) => timingEvents.push(event));

    globalThis.fetch = vi.fn(async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`data: {"sessionId":"s1","seq":1,"timestamp":"2026-04-04T00:00:01Z","event":{"type":"turn_started"}}\n\n`));
            controller.enqueue(encoder.encode(`data: {"bad":\n\n`));
            controller.close();
          },
        }),
        { status: 200 },
      )) as typeof fetch;

    await new Promise<void>((resolve, reject) => {
      streamSession({
        baseUrl: "http://runtime.test",
        sessionId: "s1",
        timing: {
          category: "session.stream",
          measurementOperationId: "mop_test",
        },
        onEvent: () => undefined,
        onClose: resolve,
        onError: reject,
      });
    });

    expect(timingEvents.some((event) =>
      event.type === "stream" && event.phase === "connect"
    )).toBe(true);
    expect(timingEvents.some((event) =>
      event.type === "stream" && event.phase === "first_event"
    )).toBe(true);
    expect(timingEvents.some((event) =>
      event.type === "stream" && event.phase === "event" && event.eventCount === 1
    )).toBe(true);
    expect(timingEvents.some((event) =>
      event.type === "stream"
      && event.phase === "close"
      && event.eventCount === 1
      && event.malformedEventCount === 1
    )).toBe(true);
    expect(timingEvents[0]).not.toHaveProperty("payload");
    expect(timingEvents[0]).not.toHaveProperty("url");
  });
});

const encoder = new TextEncoder();
