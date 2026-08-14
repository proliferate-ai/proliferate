import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DesktopRuntimeBridge,
  SupportSnapshotPreparation,
} from "@proliferate/product-client/host/desktop-bridge";
import {
  collectResolvedSupportSessionEvidence,
  resolveSupportSnapshotAccess,
} from "#product/lib/access/anyharness/support-snapshot-connection";
import type {
  ResolvedSupportSnapshotAccess,
} from "#product/lib/domain/support/support-snapshot-access-contract";
import type {
  SupportWindowMetaV1,
} from "#product/lib/domain/support/support-session-contract";

const CAPTURED_AT = "2026-08-12T00:00:00.000Z";
const FROM = "2026-08-11T23:45:00.000Z";
const DEADLINE = "2026-08-12T00:00:05.000Z";

const preparation: SupportSnapshotPreparation = {
  preparationId: "preparation-1",
  preparationOperationId: "operation-1",
  capturedAt: CAPTURED_AT,
  window: { sourceTimeFrom: FROM, sourceTimeTo: CAPTURED_AT },
};

type BoundAccess = Extract<ResolvedSupportSnapshotAccess, { state: "resolved" }>;
type FetchOverride = (url: URL, init: RequestInit) => Response | Promise<Response> | undefined;

function meta(
  presentationOrder: SupportWindowMetaV1["presentationOrder"],
  itemLimit: number,
  responseByteLimit: number,
  returnedItems: number,
  completeness: "complete" | "limit_uncertain" = "complete",
): SupportWindowMetaV1 {
  return {
    schemaVersion: 1,
    selection: "newest_matching",
    presentationOrder,
    itemLimit,
    responseByteLimit,
    returnedItems,
    omittedOversizedItems: 0,
    completeness,
  };
}

function session(id: string, updatedAt = "2026-08-11T23:59:00.000Z") {
  return {
    agentKind: "codex",
    createdAt: "2026-08-11T23:50:00.000Z",
    id,
    status: "running",
    updatedAt,
    workspaceId: "runtime-workspace-1",
    title: `Session ${id}`,
    liveConfig: null,
  };
}

function event(
  seq: number,
  timestamp = "2026-08-11T23:59:30.000Z",
  sessionId = "runtime-session-1",
) {
  return { seq, timestamp, sessionId, event: { type: "turn_started" } };
}

function raw(
  seq: number,
  timestamp = "2026-08-11T23:59:45.000Z",
  sessionId = "runtime-session-1",
) {
  return { seq, timestamp, sessionId, notificationKind: "output", notification: { text: "raw" } };
}

function responseBody(items: unknown[], window: SupportWindowMetaV1): object {
  return { window, items };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function bodyBytes(body: unknown): number {
  return new TextEncoder().encode(JSON.stringify(body)).byteLength;
}

function defaultBody(url: URL): object {
  const limit = Number(url.searchParams.get("limit"));
  const maxBytes = Number(url.searchParams.get("max_response_bytes"));
  if (url.pathname.endsWith("/sessions/support-window")) {
    const id = url.searchParams.get("session_id") ?? "runtime-session-1";
    return responseBody(
      [session(id)],
      meta("updated_desc_id_asc", limit, maxBytes, 1),
    );
  }
  const sessionId = decodeURIComponent(url.pathname.split("/")[3]);
  if (url.pathname.endsWith("/events/support-window")) {
    return responseBody([event(1, undefined, sessionId)], meta("seq_asc", limit, maxBytes, 1));
  }
  return responseBody([raw(2, undefined, sessionId)], meta("seq_asc", limit, maxBytes, 1));
}

function transport(override?: FetchOverride): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const custom = override?.(url, init ?? {});
    return custom ?? jsonResponse(defaultBody(url));
  });
}

async function access(
  selection: "active_session" | "recent_activity",
  fetch: typeof globalThis.fetch,
  runtimeUrl = "http://127.0.0.1:4477",
): Promise<BoundAccess> {
  const runtime: DesktopRuntimeBridge = {
    getConnection: vi.fn().mockResolvedValue({
      connection: { runtimeUrl, authToken: "native-token", fetch },
      status: "healthy",
    }),
    restart: vi.fn(),
  };
  const resolved = await resolveSupportSnapshotAccess({
    selection,
    capturedRuntime: { url: `${runtimeUrl}/`, source: "native_capture" },
    selectedWorkspace: {
      kind: "bundled_local",
      workspaceId: "workspace-1",
      anyharnessWorkspaceId: "runtime-workspace-1",
    },
    activeSession: selection === "active_session" ? {
      uiSessionId: "ui-session-1",
      directoryWorkspaceId: "workspace-1",
      materializedSessionId: "runtime-session-1",
    } : null,
    runtime,
  });
  if (resolved.state !== "resolved") throw new Error(`Unexpected access: ${resolved.state}`);
  return resolved;
}

async function collect(
  selection: "active_session" | "recent_activity",
  fetch: typeof globalThis.fetch,
  prepared = preparation,
) {
  return collectResolvedSupportSessionEvidence({
    preparation: prepared,
    access: await access(selection, fetch),
  });
}

describe("support session evidence collection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(CAPTURED_AT));
  });

  afterEach(() => vi.useRealTimers());

  it("binds all calls to the trusted SDK client and accounts its exact envelope identities", async () => {
    const fetch = transport();
    const result = await collect("active_session", fetch);
    expect(fetch).toHaveBeenCalledTimes(3);
    for (const [url, init] of fetch.mock.calls) {
      expect(String(url)).toMatch(/^http:\/\/127\.0\.0\.1:4477\/v1\//);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer native-token");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
    const expectedBytes = fetch.mock.calls.reduce((sum, [url]) => {
      return sum + bodyBytes(defaultBody(new URL(String(url))));
    }, 0);
    expect(result).toMatchObject({
      state: "included",
      envelope: {
        totalReadBytes: expectedBytes,
        sessionList: { state: "included" },
        sessions: [{
          summary: { state: "included" },
          events: { state: "included" },
          rawNotifications: { state: "included" },
        }],
      },
    });
    if (result.state === "included") {
      expect(JSON.parse(result.sessionEvidenceJson)).toEqual(result.envelope);
      expect(result.envelope.sessions[0].summary).not.toHaveProperty("liveConfig");
      expect(result.envelope.sessionList).not.toHaveProperty("payload");
    }
  });

  it("rejects clones, transplanted bindings, and unbound fabricated access before fetch", async () => {
    const fetchA = transport();
    const fetchB = transport();
    const accessA = await access("active_session", fetchA);
    const accessB = await access("active_session", fetchB, "http://127.0.0.1:4488");
    for (const forged of [
      { ...accessA },
      { ...accessA, selection: accessB.selection },
      { state: "resolved", selection: accessA.selection, responseBytes: 1 },
    ]) {
      await expect(collectResolvedSupportSessionEvidence({
        preparation,
        access: forged as BoundAccess,
      })).resolves.toEqual({ state: "cancelled" });
    }
    expect(fetchA).not.toHaveBeenCalled();
    expect(fetchB).not.toHaveBeenCalled();
  });

  it("preserves active endpoint independence and measured invalid/empty bytes", async () => {
    const badSummary = responseBody(
      [session("different-session")],
      meta("updated_desc_id_asc", 1, 1_048_576, 1),
    );
    const emptyEvents = responseBody([], meta("seq_asc", 200, 4_194_304, 0));
    const fetch = transport((url) => {
      if (url.pathname.endsWith("/sessions/support-window")) return jsonResponse(badSummary);
      if (url.pathname.endsWith("/events/support-window")) return jsonResponse(emptyEvents);
      return undefined;
    });
    const result = await collect("active_session", fetch);
    const rawBody = defaultBody(new URL(String(fetch.mock.calls[2][0])));
    expect(result).toMatchObject({
      state: "included",
      envelope: {
        totalReadBytes: bodyBytes(badSummary) + bodyBytes(emptyEvents) + bodyBytes(rawBody),
        sessionList: { state: "omitted", reason: "session_invalid", includedBytes: 0 },
        sessions: [{
          summary: { state: "omitted", reason: "session_invalid", includedBytes: 0 },
          events: { state: "included", includedBytes: 0, payload: [] },
          rawNotifications: { state: "included" },
        }],
      },
      sessionCollection: { sessionIncludedBytes: 0, eventIncludedBytes: 0 },
    });
  });

  it("shares the exact ten-thousand-value projection budget across one session", async () => {
    const items = Array.from({ length: 38 }, (_, index) => ({
      ...event(index + 1),
      event: {
        type: "turn_started",
        values: new Array(index === 37 ? 248 : 256).fill(null),
      },
    }));
    const eventsBody = responseBody(
      items,
      meta("seq_asc", 200, 4_194_304, items.length),
    );
    const fetch = transport((url) => url.pathname.endsWith("/events/support-window")
      ? jsonResponse(eventsBody)
      : undefined);
    const result = await collect("active_session", fetch);
    expect(result).toMatchObject({
      state: "included",
      envelope: { sessions: [{
        events: { state: "included" },
        rawNotifications: { state: "omitted", reason: "session_invalid" },
      }] },
    });
  });

  it.each([
    { count: 0, completeness: "complete", uncertain: 0 },
    { count: 0, completeness: "limit_uncertain", uncertain: 1 },
    { count: 1, completeness: "complete", uncertain: 0 },
    { count: 1, completeness: "limit_uncertain", uncertain: 1 },
    { count: 3, completeness: "complete", uncertain: 0 },
    { count: 3, completeness: "limit_uncertain", uncertain: 1 },
  ] as const)(
    "retains one response shell for $count recent sessions in $completeness state",
    async ({ count, completeness, uncertain }) => {
      const items = Array.from({ length: count }, (_, index) => session(
        String.fromCharCode(97 + index),
        `2026-08-11T23:${59 - index}:00.000Z`,
      ));
      const listBody = responseBody(
        items,
        meta("updated_desc_id_asc", 3, 1_048_576, count, completeness),
      );
      const fetch = transport((url) => url.pathname.endsWith("/sessions/support-window")
        ? jsonResponse(listBody)
        : undefined);
      const result = await collect("recent_activity", fetch);
      expect(result).toMatchObject({
        state: "included",
        sessionCollection: {
          selectedSessions: count,
          sessionIncludedBytes: count === 0 ? 0 : bodyBytes(listBody),
          limitUncertainEndpoints: uncertain,
        },
        envelope: {
          totalReadBytes: expect.any(Number),
          sessionList: {
            state: completeness === "complete" ? "included" : "limit_uncertain",
            includedBytes: count === 0 ? 0 : bodyBytes(listBody),
          },
          sessions: expect.any(Array),
        },
      });
      if (result.state === "included") {
        const measuredBytes = fetch.mock.calls.reduce((sum, [input]) => {
          const url = new URL(String(input));
          return sum + bodyBytes(url.pathname.endsWith("/sessions/support-window")
            ? listBody
            : defaultBody(url));
        }, 0);
        expect(result.envelope.totalReadBytes).toBe(measuredBytes);
        expect(result.envelope.sessions).toHaveLength(count);
        result.envelope.sessions.forEach((shell, index) => {
          expect(shell.index).toBe(index);
          expect(shell.summary).toMatchObject({
            capturedAt: result.envelope.sessionList.capturedAt,
            state: result.envelope.sessionList.state,
            includedBytes: index === 0 ? result.envelope.sessionList.includedBytes : 0,
            window: result.envelope.sessionList.window,
          });
        });
      }
    },
  );

  it("orders recent summaries with exact nanosecond precision and rejects reversed sub-ms order", async () => {
    const exactPreparation: SupportSnapshotPreparation = {
      ...preparation,
      capturedAt: "2026-08-12T00:00:00.000000009Z",
      window: {
        sourceTimeFrom: "2026-08-11T23:45:00.000000009Z",
        sourceTimeTo: "2026-08-12T00:00:00.000000009Z",
      },
    };
    const cases = [
      { valid: true, items: [session("z", "2026-08-11T23:59:00.000000002Z"),
        session("a", "2026-08-11T23:59:00.000000001Z")] },
      { valid: false, items: [session("a", "2026-08-11T23:59:00.000000001Z"),
        session("z", "2026-08-11T23:59:00.000000002Z")] },
      { valid: true, items: [session("a"), session("b")] },
      { valid: false, items: [session("b"), session("a")] },
    ];
    for (const { items, valid } of cases) {
      const listBody = responseBody(items, meta("updated_desc_id_asc", 3, 1_048_576, 2));
      const fetch = transport((url) => url.pathname.endsWith("/sessions/support-window")
        ? jsonResponse(listBody)
        : undefined);
      const result = await collect("recent_activity", fetch, exactPreparation);
      expect(result.state).toBe(valid ? "included" : "omitted");
      if (!valid) {
        expect(result).toMatchObject({ sessionCollection: { reason: "session_invalid" } });
      }
    }
  });

  it("uses exact nanosecond source bounds and permits only the zero UTC offset response form", async () => {
    const exactPreparation: SupportSnapshotPreparation = {
      ...preparation,
      capturedAt: "2026-08-12T00:00:00.000000001Z",
      window: {
        sourceTimeFrom: "2026-08-11T23:45:00.000000001Z",
        sourceTimeTo: "2026-08-12T00:00:00.000000001Z",
      },
    };
    const events = [
      event(1, "2026-08-11T23:45:00.000000000Z"),
      event(2, "2026-08-11T23:45:00.000000001+00:00"),
      event(3, "2026-08-12T00:00:00.000000001Z"),
      event(4, "2026-08-12T00:00:00.000000002Z"),
      event(5, "2026-08-11T23:59:00.000000001+01:00"),
      event(6, "2026-08-11T23:59:00.0000000001Z"),
      event(7, "2026-08-11T23:59:00.000000001z"),
    ];
    const body = responseBody(events, meta("seq_asc", 200, 4_194_304, events.length));
    const fetch = transport((url) => url.pathname.endsWith("/events/support-window")
      ? jsonResponse(body)
      : undefined);
    const result = await collect("active_session", fetch, exactPreparation);
    expect(result).toMatchObject({
      state: "included",
      envelope: { sessions: [{ events: { payload: [
        { index: 0, value: { seq: 2 } },
        { index: 1, value: { seq: 3 } },
      ] } }] },
    });
  });

  it("rejects inconsistent SDK response metadata without silent truncation or fanout", async () => {
    const malformed = responseBody(
      [session("runtime-session-1")],
      meta("updated_desc_id_asc", 3, 1_048_576, 2),
    );
    const fetch = transport((url) => url.pathname.endsWith("/sessions/support-window")
      ? jsonResponse(malformed)
      : undefined);
    await expect(collect("recent_activity", fetch)).resolves.toMatchObject({
      state: "omitted",
      sessionCollection: { reason: "session_unavailable" },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["bad id", "bad\tid", "bad\u00a0id", "bad\u2003id"])(
    "rejects response identity whitespace without trimming: %s",
    async (id) => {
      const listBody = responseBody(
        [session(id)],
        meta("updated_desc_id_asc", 3, 1_048_576, 1),
      );
      const fetch = transport((url) => url.pathname.endsWith("/sessions/support-window")
        ? jsonResponse(listBody)
        : undefined);
      await expect(collect("recent_activity", fetch)).resolves.toMatchObject({
        state: "omitted",
        sessionCollection: { reason: "session_invalid" },
      });
    },
  );

  it("rejects collection starting at the consent-bound deadline with zero transport work", async () => {
    vi.setSystemTime(new Date(DEADLINE));
    const fetch = transport();
    await expect(collect("active_session", fetch)).resolves.toEqual({
      state: "omitted",
      sessionEvidenceJson: null,
      sessionCollection: { state: "omitted", reason: "session_timeout" },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires canonical Z timestamps on the frozen preparation", async () => {
    const fetch = transport();
    const noncanonical = {
      ...preparation,
      capturedAt: "2026-08-12T00:00:00.000+00:00",
      window: { ...preparation.window, sourceTimeTo: "2026-08-12T00:00:00.000+00:00" },
    };
    await expect(collect("active_session", fetch, noncanonical))
      .resolves.toEqual({ state: "cancelled" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does zero transport work for recent activity without a bundled-local selection", async () => {
    const fetch = transport();
    await expect(collectResolvedSupportSessionEvidence({
      preparation,
      access: {
        state: "none",
        binding: { kind: "none", reason: "no_selected_bundled_local_workspace" },
      },
    })).resolves.toMatchObject({
      state: "omitted",
      sessionCollection: { reason: "no_selected_bundled_local_workspace" },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts just before the deadline without starting a fresh five-second window", async () => {
    vi.setSystemTime(new Date("2026-08-12T00:00:04.999Z"));
    const result = await collect("active_session", transport());
    expect(result).toMatchObject({
      state: "included",
      envelope: {
        sessionList: { capturedAt: "2026-08-12T00:00:04.999000000Z" },
        sessions: [{ events: { capturedAt: "2026-08-12T00:00:04.999000000Z" } }],
      },
    });
  });

  it("rejects fulfillment at the deadline even when fetch ignores abort", async () => {
    vi.setSystemTime(new Date("2026-08-12T00:00:04.999Z"));
    const fetch = transport((url) => {
      vi.setSystemTime(new Date(DEADLINE));
      return jsonResponse(defaultBody(url));
    });
    const result = await collect("active_session", fetch);
    expect(result).toMatchObject({
      state: "included",
      envelope: {
        sessionList: { capturedAt: "2026-08-12T00:00:05.000000000Z", reason: "session_timeout" },
        sessions: [{
          summary: { capturedAt: "2026-08-12T00:00:05.000000000Z", reason: "session_timeout" },
          events: { capturedAt: "2026-08-12T00:00:05.000000000Z", reason: "session_timeout" },
          rawNotifications: {
            capturedAt: "2026-08-12T00:00:05.000000000Z",
            reason: "session_timeout",
          },
        }],
      },
    });
  });

  it("settles ignored-abort work at the absolute deadline and observes late rejection", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const fetch = transport(() => new Promise<Response>((_resolve, reject) => {
        setTimeout(() => reject(new Error("late transport rejection")), 10_000);
      }));
      const promise = collect("active_session", fetch);
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(promise).resolves.toMatchObject({
        state: "included",
        envelope: {
          sessionList: {
            capturedAt: "2026-08-12T00:00:05.000000000Z",
            reason: "session_timeout",
          },
          sessions: [{
            events: { capturedAt: "2026-08-12T00:00:05.000000000Z", reason: "session_timeout" },
          }],
        },
      });
      await vi.advanceTimersByTimeAsync(5_000);
      await Promise.resolve();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it.each([0, 1] as const)(
    "enforces the measured 8 MiB aggregate boundary plus %i byte",
    async (extraByte) => {
      const listBody = responseBody(
        [session("a", "2026-08-11T23:59:00.000Z"), session("b", "2026-08-11T23:58:00.000Z")],
        meta("updated_desc_id_asc", 3, 1_048_576, 2),
      );
      const eventA = paddedEvidenceBody("event", "a", 4_194_304);
      const rawA = paddedEvidenceBody("raw", "a", 2_097_152);
      const rawB = responseBody([raw(2, undefined, "b")], meta("seq_asc", 100, 2_097_152, 1));
      const eventBBytes = 8_388_608 + extraByte
        - bodyBytes(listBody) - bodyBytes(eventA) - bodyBytes(rawA) - bodyBytes(rawB);
      const eventB = paddedEvidenceBody("event", "b", eventBBytes);
      const fetch = transport((url) => {
        if (url.pathname.endsWith("/sessions/support-window")) return jsonResponse(listBody);
        const sessionId = decodeURIComponent(url.pathname.split("/")[3]);
        if (url.pathname.endsWith("/events/support-window")) {
          return jsonResponse(sessionId === "a" ? eventA : eventB);
        }
        return jsonResponse(sessionId === "a" ? rawA : rawB);
      });
      const result = await collect("recent_activity", fetch);
      expect(result.state).toBe(extraByte === 0 ? "included" : "omitted");
      if (extraByte === 0 && result.state === "included") {
        expect(result.envelope.totalReadBytes).toBe(8_388_608);
      } else if (extraByte === 1) {
        expect(result).toMatchObject({ sessionCollection: { reason: "session_invalid" } });
      }
    },
  );

  it("does no endpoint fanout after a recent selection epoch becomes stale", async () => {
    let current = true;
    const fetch = transport((url) => {
      if (!url.pathname.endsWith("/sessions/support-window")) return undefined;
      current = false;
      return jsonResponse(defaultBody(url));
    });
    const result = await collectResolvedSupportSessionEvidence({
      preparation,
      access: await access("recent_activity", fetch),
      isSelectionCurrent: () => current,
    });
    expect(result).toEqual({ state: "cancelled" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

function paddedEvidenceBody(
  kind: "event" | "raw",
  sessionId: string,
  targetBytes: number,
): object {
  const item: Record<string, unknown> = kind === "event"
    ? { ...event(1, undefined, sessionId), event: { type: "turn_started", text: "" } }
    : { ...raw(2, undefined, sessionId), notification: { text: "" } };
  const body = responseBody(
    [item],
    meta("seq_asc", kind === "event" ? 200 : 100, kind === "event" ? 4_194_304 : 2_097_152, 1),
  );
  const padding = targetBytes - bodyBytes(body);
  if (padding < 0) throw new Error("Invalid padded response target");
  if (kind === "event") (item.event as { text: string }).text = "x".repeat(padding);
  else (item.notification as { text: string }).text = "x".repeat(padding);
  if (bodyBytes(body) !== targetBytes) throw new Error("Response padding mismatch");
  return body;
}
