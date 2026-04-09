import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  SessionEventEnvelope,
  SessionRawNotificationEnvelope,
} from "@anyharness/sdk";
import {
  canonicalizeSessionEvents,
  canonicalizeSessionRawNotifications,
  exportSessionEvents,
  exportSessionRawNotifications,
  formatExportedSessionEvents,
  formatExportedSessionRawNotifications,
} from "./session-event-export.js";
import { parseCliArgs } from "./export-session-events.js";

const originalFetch = globalThis.fetch;

describe("session event export", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it("sorts exported events by seq", () => {
    const events = canonicalizeSessionEvents([
      envelope(3),
      envelope(1),
      envelope(2),
    ]);

    expect(events.map((event) => event.seq)).toEqual([1, 2, 3]);
  });

  it("writes canonical JSON fixtures without reshaping", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "session-export-"));
    const outPath = path.join(tempDir, "fixture.json");

    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify([envelope(2), envelope(1)]), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    const events = await exportSessionEvents({
      sessionId: "session-1",
      baseUrl: "http://127.0.0.1:8457",
      authToken: "secret-token",
      outPath,
    });

    expect(events.map((event) => event.seq)).toEqual([1, 2]);
    expect(await readFile(outPath, "utf8")).toBe(formatExportedSessionEvents(events));
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8457/v1/sessions/session-1/events",
      expect.objectContaining({
        method: "GET",
      }),
    );
  });

  it("writes canonical raw notification fixtures without reshaping", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "session-raw-export-"));
    const outPath = path.join(tempDir, "raw.json");

    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify([rawEnvelope(2), rawEnvelope(1)]), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    const notifications = await exportSessionRawNotifications({
      sessionId: "session-1",
      baseUrl: "http://127.0.0.1:8457",
      authToken: "secret-token",
      outPath,
    });

    expect(notifications.map((notification) => notification.seq)).toEqual([1, 2]);
    expect(await readFile(outPath, "utf8")).toBe(
      formatExportedSessionRawNotifications(notifications),
    );
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8457/v1/sessions/session-1/raw-notifications",
      expect.objectContaining({
        method: "GET",
      }),
    );
  });

  it("sorts exported raw notifications by seq", () => {
    const notifications = canonicalizeSessionRawNotifications([
      rawEnvelope(3),
      rawEnvelope(1),
      rawEnvelope(2),
    ]);

    expect(notifications.map((notification) => notification.seq)).toEqual([1, 2, 3]);
  });

  it("parses base URL, auth token, after seq, and output path from CLI args", () => {
    const args = parseCliArgs([
      "--session-id",
      "session-123",
      "--base-url",
      "http://runtime.test",
      "--auth-token",
      "token-123",
      "--after-seq",
      "19",
      "--out",
      "/tmp/events.json",
      "--raw-out",
      "/tmp/raw.json",
    ]);

    expect(args).toEqual({
      sessionId: "session-123",
      baseUrl: "http://runtime.test",
      authToken: "token-123",
      afterSeq: 19,
      outPath: "/tmp/events.json",
      rawOutPath: "/tmp/raw.json",
    });
  });

  it("falls back to env vars for base URL and auth token", () => {
    vi.stubEnv("ANYHARNESS_BASE_URL", "http://env-runtime.test");
    vi.stubEnv("ANYHARNESS_AUTH_TOKEN", "env-token");

    expect(parseCliArgs(["--session-id", "session-abc"])).toEqual({
      sessionId: "session-abc",
      baseUrl: "http://env-runtime.test",
      authToken: "env-token",
      afterSeq: undefined,
      outPath: undefined,
      rawOutPath: undefined,
    });
  });
});

function envelope(seq: number): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    event: {
      type: "turn_started",
    },
  };
}

function rawEnvelope(seq: number): SessionRawNotificationEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    notificationKind: "agent_message_chunk",
    notification: {
      delta: `chunk-${seq}`,
    },
  };
}
