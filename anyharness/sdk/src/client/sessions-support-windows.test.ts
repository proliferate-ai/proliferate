import { describe, expect, it, vi } from "vitest";

import type { AnyHarnessRequestOptions, AnyHarnessTransport } from "./core.js";
import { SessionsClient } from "./sessions.js";
import { supportWindowResponseBytes } from "./support-window-response-bytes.js";

const timestampFrom = "2026-08-12T12:00:00.123456789Z";
const timestampTo = "2026-08-12T12:15:00.123456789Z";
// Case name, the exact text the desktop producer emits, then the canonical wire text the SDK must send.
const nativeWindows = [
  ["whole second", "2026-08-12T11:45:00.000Z", "2026-08-12T12:00:00.000Z", "2026-08-12T11:45:00Z", "2026-08-12T12:00:00Z"],
  ["millisecond", "2026-08-12T11:45:00.123Z", "2026-08-12T12:00:00.123Z", "2026-08-12T11:45:00.123Z", "2026-08-12T12:00:00.123Z"],
  ["lowercase z and explicit offset", "2026-08-12T11:45:00.1z", "2026-08-12T12:00:00.100000+00:00", "2026-08-12T11:45:00.100Z", "2026-08-12T12:00:00.100Z"],
] as const;

describe("SessionsClient support windows", () => {
  it("serializes an exact session query and preserves nested request data", async () => {
    const controller = new AbortController();
    const headers = { "x-support-request": "snapshot-1" };
    const lifecycle = { onRequestStart: vi.fn() };
    const response = sessionWindow([sessionResponse()]);
    const { client, getBoundedJson } = clientReturning(response);

    const result = await client.listSupportWindow("workspace/one", {
      mode: "exact",
      sessionId: "session/one",
      updatedAtTo: timestampTo,
      limit: 1,
      maxResponseBytes: 1_048_576,
      request: {
        headers,
        measurementOperationId: "mop_support",
        signal: controller.signal,
        timingCategory: "session.events.list",
        timingLifecycle: lifecycle,
        timingScope: { runtimeUrlHash: "scope_support" },
      },
    });

    expect(getBoundedJson.mock.calls[0]?.[0]).toBe(
      "/v1/workspaces/workspace%2Fone/sessions/support-window?"
        + "mode=exact&session_id=session%2Fone"
        + `&updated_at_to=${encodeURIComponent(timestampTo)}`
        + "&limit=1&max_response_bytes=1048576",
    );
    expect(getBoundedJson.mock.calls[0]?.[1]).toBe(1_048_576);
    const request = getBoundedJson.mock.calls[0]?.[2] as AnyHarnessRequestOptions;
    expect(new Headers(request.headers).get("x-support-request")).toBe("snapshot-1");
    expect(request).toMatchObject({
      measurementOperationId: "mop_support",
      signal: controller.signal,
      timingCategory: "session.events.list",
      timingScope: { runtimeUrlHash: "scope_support" },
    });
    expect(request.timingLifecycle?.onRequestStart).toBe(lifecycle.onRequestStart);
    expect(result.items[0]).toMatchObject({
      id: "session-1",
      actionCapabilities: { fork: false, targetedFork: false },
      liveConfig: null,
    });
  });

  it("serializes a recent session query in the frozen order", async () => {
    const { client, getBoundedJson } = clientReturning(sessionWindow([], 3));

    await client.listSupportWindow("workspace-1", {
      mode: "recent",
      updatedAtFrom: timestampFrom,
      updatedAtTo: timestampTo,
      limit: 3,
      maxResponseBytes: 1_048_576,
      request: {},
    });

    expect(getBoundedJson.mock.calls[0]?.[0]).toBe(
      "/v1/workspaces/workspace-1/sessions/support-window?"
        + `mode=recent&updated_at_from=${encodeURIComponent(timestampFrom)}`
        + `&updated_at_to=${encodeURIComponent(timestampTo)}`
        + "&limit=3&max_response_bytes=1048576",
    );
  });

  it("uses the exact event endpoint, bounds, and seq presentation metadata", async () => {
    const response = evidenceWindow([eventResponse()], 2, 65_536);
    const { client, getBoundedJson } = clientReturning(response);

    const result = await client.listEventsSupportWindow("session/one", {
      timestampFrom,
      timestampTo,
      limit: 2,
      maxResponseBytes: 65_536,
      request: {},
    });

    expect(getBoundedJson).toHaveBeenCalledWith(
      "/v1/sessions/session%2Fone/events/support-window?"
        + `timestamp_from=${encodeURIComponent(timestampFrom)}`
        + `&timestamp_to=${encodeURIComponent(timestampTo)}`
        + "&limit=2&max_response_bytes=65536",
      65_536,
      {},
    );
    expect(result).toEqual(response);
  });

  it("uses the exact raw-notification endpoint and maximum cap", async () => {
    const response = evidenceWindow([rawNotificationResponse()], 100, 2_097_152);
    const { client, getBoundedJson } = clientReturning(response);

    const result = await client.listRawNotificationsSupportWindow("session-1", {
      timestampFrom,
      timestampTo,
      limit: 100,
      maxResponseBytes: 2_097_152,
      request: {},
    });

    expect(getBoundedJson.mock.calls[0]?.[0]).toContain(
      "/v1/sessions/session-1/raw-notifications/support-window?",
    );
    expect(getBoundedJson.mock.calls[0]?.[1]).toBe(2_097_152);
    expect(result).toEqual(response);
  });

  const spelling = "sends a native %s window as canonical wire text";
  it.each(nativeWindows)(spelling, async (_name, from, to, wireFrom, wireTo) => {
    for (const [prefix, response, send] of nativeWindowSenders(from, to)) {
      const { client, getBoundedJson } = clientReturning(response);
      await send(client);
      expect(getBoundedJson).toHaveBeenCalledOnce();
      const path = getBoundedJson.mock.calls[0]?.[0] as string;
      const query = new URLSearchParams(path.slice(path.indexOf("?") + 1));
      const sent = [query.get(`${prefix}_from`) ?? "", query.get(`${prefix}_to`) ?? ""];
      expect(sent).toEqual([wireFrom, wireTo]);
      expect(sent.map((value) => Date.parse(value))).toEqual([Date.parse(from), Date.parse(to)]);
      expect(Date.parse(sent[1] ?? "") - Date.parse(sent[0] ?? "")).toBe(900_000);
    }
  });

  it.each([
    ["non-UTC offset", { timestampFrom: "2026-08-12T12:00:00+01:00" }],
    ["unknown UTC offset", { timestampFrom: "2026-08-12T12:00:00-00:00" }],
    ["invalid day", { timestampFrom: "2026-02-30T12:00:00Z" }],
    ["inverted", { timestampFrom: timestampTo, timestampTo: timestampFrom }],
    ["over fifteen minutes", { timestampFrom: "2026-08-12T11:59:59.123456789Z" }],
    ["zero limit", { limit: 0 }],
    ["event limit overflow", { limit: 201 }],
    ["response below minimum", { maxResponseBytes: 16_383 }],
    ["response above event cap", { maxResponseBytes: 4_194_305 }],
  ])("rejects invalid event options: %s", async (_name, replacement) => {
    const { client, getBoundedJson } = clientReturning(evidenceWindow([], 1, 16_384));
    const options = {
      timestampFrom,
      timestampTo,
      limit: 1,
      maxResponseBytes: 16_384,
      request: {},
      ...replacement,
    };

    await expect(
      client.listEventsSupportWindow("session-1", options),
    ).rejects.toThrow("Invalid support-window options");
    expect(getBoundedJson).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown mode", { mode: "other" }],
    ["wrong exact limit", { limit: 2 }],
    ["wrong session cap", { maxResponseBytes: 1_048_575 }],
    ["empty exact id", { sessionId: "" }],
    ["exact/recent mix", { updatedAtFrom: timestampFrom }],
  ])("rejects invalid exact session options: %s", async (_name, replacement) => {
    const { client, getBoundedJson } = clientReturning(sessionWindow([]));
    const options = {
      mode: "exact",
      sessionId: "session-1",
      updatedAtTo: timestampTo,
      limit: 1,
      maxResponseBytes: 1_048_576,
      request: {},
      ...replacement,
    };

    await expect(
      client.listSupportWindow("workspace-1", options as never),
    ).rejects.toThrow("Invalid support-window options");
    expect(getBoundedJson).not.toHaveBeenCalled();
  });

  it("rejects inherited and accessor-backed query options without invoking them", async () => {
    const getter = vi.fn(() => timestampTo);
    const options = Object.create({ limit: 1 }) as Record<string, unknown>;
    Object.defineProperties(options, {
      mode: { enumerable: true, value: "exact" },
      sessionId: { enumerable: true, value: "session-1" },
      updatedAtTo: { enumerable: true, get: getter },
      maxResponseBytes: { enumerable: true, value: 1_048_576 },
      request: { enumerable: true, value: {} },
    });
    const { client, getBoundedJson } = clientReturning(sessionWindow([]));

    await expect(
      client.listSupportWindow("workspace-1", options as never),
    ).rejects.toThrow("Invalid support-window options");
    expect(getter).not.toHaveBeenCalled();
    expect(getBoundedJson).not.toHaveBeenCalled();
  });

  it("fails closed for a revoked options proxy", async () => {
    const target = {
      mode: "exact",
      sessionId: "session-1",
      updatedAtTo: timestampTo,
      limit: 1,
      maxResponseBytes: 1_048_576,
      request: {},
    };
    const revocable = Proxy.revocable(target, {});
    revocable.revoke();
    const { client, getBoundedJson } = clientReturning(sessionWindow([]));

    await expect(
      client.listSupportWindow("workspace-1", revocable.proxy as never),
    ).rejects.toBeInstanceOf(TypeError);
    expect(getBoundedJson).not.toHaveBeenCalled();
  });

  it("enforces UTF-8 byte and Unicode whitespace/control limits for every path id", async () => {
    const exact128Bytes = "é".repeat(64);
    const over128Bytes = "é".repeat(65);
    const sessionFixture = sessionWindow([]);
    const accepted = clientReturning(sessionFixture);
    await accepted.client.listSupportWindow(exact128Bytes, exactSessionOptions());
    expect(accepted.getBoundedJson.mock.calls[0]?.[0]).toContain(
      encodeURIComponent(exact128Bytes),
    );

    for (const invalidId of [
      over128Bytes,
      "id\u2003suffix",
      "id\u0085suffix",
      "id\uD800suffix",
    ]) {
      const sessionClient = clientReturning(sessionFixture);
      await expect(
        sessionClient.client.listSupportWindow(invalidId, exactSessionOptions()),
      ).rejects.toThrow("Invalid support-window options");
      expect(sessionClient.getBoundedJson).not.toHaveBeenCalled();

      const eventClient = clientReturning(evidenceWindow([], 1, 16_384));
      await expect(eventClient.client.listEventsSupportWindow(invalidId, {
        timestampFrom,
        timestampTo,
        limit: 1,
        maxResponseBytes: 16_384,
        request: {},
      })).rejects.toThrow("Invalid support-window options");
      expect(eventClient.getBoundedJson).not.toHaveBeenCalled();
    }
  });

  it("enforces the UTF-8 byte bound on exact option sessionId", async () => {
    const accepted = clientReturning(sessionWindow([]));
    await accepted.client.listSupportWindow("workspace-1", {
      ...exactSessionOptions(),
      sessionId: "é".repeat(64),
    });
    expect(accepted.getBoundedJson).toHaveBeenCalledOnce();

    const rejected = clientReturning(sessionWindow([]));
    await expect(rejected.client.listSupportWindow("workspace-1", {
      ...exactSessionOptions(),
      sessionId: "é".repeat(65),
    })).rejects.toThrow("sessionId is invalid");
    expect(rejected.getBoundedJson).not.toHaveBeenCalled();
  });

  it("rejects accessor-bearing nested request values without invoking them", async () => {
    const getter = vi.fn(() => "must-not-run");
    const headers = {} as Record<string, unknown>;
    Object.defineProperty(headers, "x-support", { enumerable: true, get: getter });
    const timingScope = {} as Record<string, unknown>;
    Object.defineProperty(timingScope, "runtimeUrlHash", {
      enumerable: true,
      get: getter,
    });
    const timingLifecycle = {} as Record<string, unknown>;
    Object.defineProperty(timingLifecycle, "onRequestStart", {
      enumerable: true,
      get: getter,
    });

    for (const request of [
      { headers },
      { timingScope },
      { timingLifecycle },
      { signal: {} },
    ]) {
      const { client, getBoundedJson } = clientReturning(sessionWindow([]));
      await expect(client.listSupportWindow("workspace-1", {
        ...exactSessionOptions(),
        request: request as AnyHarnessRequestOptions,
      })).rejects.toThrow("Invalid support-window options");
      expect(getBoundedJson).not.toHaveBeenCalled();
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it("does not invoke response accessors", async () => {
    const getter = vi.fn(() => sessionWindow([]).window);
    const response = { items: [] } as Record<string, unknown>;
    Object.defineProperty(response, "window", { enumerable: true, get: getter });
    const { client } = clientReturning(response);

    await expect(
      client.listSupportWindow("workspace-1", exactSessionOptions()),
    ).rejects.toThrow("Invalid support-window response");
    expect(getter).not.toHaveBeenCalled();
  });

  it("fails closed on overridden array iteration without invoking it", async () => {
    const item = sessionResponse();
    const items = [item];
    const iterator = vi.fn(() => {
      throw new Error("must-not-iterate");
    });
    Object.defineProperty(items, Symbol.iterator, { value: iterator });
    const { client } = clientReturning(sessionWindow(items));

    await expect(client.listSupportWindow(
      "workspace-1", exactSessionOptions(),
    )).rejects.toThrow("Invalid support-window response");
    expect(iterator).not.toHaveBeenCalled();
  });

  it("fails closed for altered, null, custom, and throwing response prototypes", async () => {
    const inheritedGetter = vi.fn(() => "must-not-run");
    const customPrototype = Object.defineProperty({}, "unexpected", {
      get: inheritedGetter,
    });
    const customItem = sessionResponse();
    Object.setPrototypeOf(customItem, customPrototype);
    const nullItem = Object.assign(Object.create(null), sessionResponse());
    const alteredItems = [sessionResponse()];
    Object.setPrototypeOf(alteredItems, Object.create(Array.prototype));
    const throwingPrototype = new Proxy(sessionResponse(), {
      getPrototypeOf() {
        throw new Error("must-not-leak");
      },
    });

    for (const response of [
      sessionWindow([customItem]),
      sessionWindow([nullItem]),
      sessionWindow([throwingPrototype]),
      sessionWindow(alteredItems),
    ]) {
      const { client } = clientReturning(response);
      await expect(
        client.listSupportWindow("workspace-1", exactSessionOptions()),
      ).rejects.toThrow("Invalid support-window response");
    }
    expect(inheritedGetter).not.toHaveBeenCalled();
  });

  it("fails closed for sparse arrays and arrays with extra properties", async () => {
    const sparse = new Array(1);
    const extraEnumerable = [sessionResponse()] as unknown[] & { extra?: string };
    extraEnumerable.extra = "hidden channel";
    const extraHidden = [sessionResponse()];
    Object.defineProperty(extraHidden, "extra", { value: "hidden channel" });

    for (const items of [sparse, extraEnumerable, extraHidden]) {
      const { client } = clientReturning(sessionWindow(items));
      await expect(
        client.listSupportWindow("workspace-1", exactSessionOptions()),
      ).rejects.toThrow("Invalid support-window response");
    }
  });

  it("fails closed for cyclic, sparse, and revoked response values", async () => {
    const cyclic = sessionWindow([]) as Record<string, unknown>;
    cyclic.cycle = cyclic;
    const sparse = sessionWindow(new Array(1));
    const revocable = Proxy.revocable(sessionWindow([]), {});
    revocable.revoke();

    for (const value of [cyclic, sparse, revocable.proxy]) {
      const { client } = clientReturning(value);
      await expect(
        client.listSupportWindow("workspace-1", exactSessionOptions()),
      ).rejects.toBeInstanceOf(TypeError);
    }
  });

  it("rejects inconsistent endpoint metadata", async () => {
    const response = sessionWindow([]);
    response.window.presentationOrder = "seq_asc";
    const { client } = clientReturning(response);

    await expect(
      client.listSupportWindow("workspace-1", exactSessionOptions()),
    ).rejects.toThrow("Invalid support-window response");
  });

  it.each([
    ["negative-zero item limit", { itemLimit: -0 }],
    ["NaN response limit", { responseByteLimit: Number.NaN }],
    ["fractional returned count", { returnedItems: 0.5 }],
    ["too many items", { itemLimit: 0 }],
    ["complete with omitted items", { omittedOversizedItems: 1 }],
  ])("rejects inconsistent numeric metadata: %s", async (_name, replacement) => {
    const response = sessionWindow([]);
    Object.assign(response.window, replacement);
    const { client } = clientReturning(response);

    await expect(
      client.listSupportWindow("workspace-1", exactSessionOptions()),
    ).rejects.toThrow("Invalid support-window response");
  });

  it("associates actual streamed bytes with normalized response identity only", async () => {
    const raw = sessionWindow([sessionResponse()]);
    const { client } = clientReturning(raw, 12_345);

    const normalized = await client.listSupportWindow(
      "workspace-1",
      exactSessionOptions(),
    );

    expect(normalized).not.toBe(raw);
    expect(supportWindowResponseBytes(normalized)).toBe(12_345);
    expect(Object.keys(normalized)).toEqual(["window", "items"]);
    expect(Object.getOwnPropertySymbols(normalized)).toEqual([]);
    expect(() => supportWindowResponseBytes(raw)).toThrow(
      "Support-window response byte count is unavailable",
    );
    expect(() => supportWindowResponseBytes({ ...normalized })).toThrow(
      "Support-window response byte count is unavailable",
    );
  });

  it("keeps concurrent support-window byte counts distinct", async () => {
    let releaseSession: (() => void) | undefined;
    let releaseEvent: (() => void) | undefined;
    const waitSession = new Promise<void>((resolve) => {
      releaseSession = resolve;
    });
    const waitEvent = new Promise<void>((resolve) => {
      releaseEvent = resolve;
    });
    const getBoundedJson = vi.fn(async (path: string) => {
      if (path.includes("/events/")) {
        await waitEvent;
        return { body: evidenceWindow([eventResponse()], 1, 16_384), bodyBytes: 222 };
      }
      await waitSession;
      return { body: sessionWindow([sessionResponse()]), bodyBytes: 111 };
    });
    const client = new SessionsClient(
      { getBoundedJson } as unknown as AnyHarnessTransport,
    );

    const sessionResult = client.listSupportWindow(
      "workspace-1",
      exactSessionOptions(),
    );
    const eventResult = client.listEventsSupportWindow("session-1", {
      timestampFrom,
      timestampTo,
      limit: 1,
      maxResponseBytes: 16_384,
      request: {},
    });
    releaseEvent?.();
    releaseSession?.();
    const [sessionEnvelope, eventEnvelope] = await Promise.all([
      sessionResult,
      eventResult,
    ]);

    expect(supportWindowResponseBytes(sessionEnvelope)).toBe(111);
    expect(supportWindowResponseBytes(eventEnvelope)).toBe(222);
  });

  it("fails closed when byte identity is missing", () => {
    expect(() => supportWindowResponseBytes({})).toThrow(TypeError);
    expect(() => supportWindowResponseBytes(null as never)).toThrow(TypeError);
  });

  it.each([-1, 0, 1_048_577])(
    "fails closed for malformed measured bytes: %s",
    async (bodyBytes) => {
      const { client } = clientReturning(sessionWindow([]), bodyBytes);
      await expect(
        client.listSupportWindow("workspace-1", exactSessionOptions()),
      ).rejects.toThrow("Invalid support-window response byte count");
    },
  );
});

/** One send per support endpoint that carries a fifteen-minute window. */
function nativeWindowSenders(from: string, to: string) {
  const evidence = { timestampFrom: from, timestampTo: to, limit: 1, maxResponseBytes: 16_384, request: {} };
  const recent = { mode: "recent", updatedAtFrom: from, updatedAtTo: to, limit: 3, maxResponseBytes: 1_048_576, request: {} } as const;
  return [
    ["updated_at", sessionWindow([], 3), (c: SessionsClient) => c.listSupportWindow("workspace-1", recent)],
    ["timestamp", evidenceWindow([], 1, 16_384), (c: SessionsClient) => c.listEventsSupportWindow("session-1", evidence)],
    ["timestamp", evidenceWindow([], 1, 16_384), (c: SessionsClient) => c.listRawNotificationsSupportWindow("session-1", evidence)],
  ] as const;
}

function clientReturning(response: unknown, bodyBytes = 1_024): {
  client: SessionsClient;
  getBoundedJson: ReturnType<typeof vi.fn>;
} {
  const getBoundedJson = vi.fn(async () => ({ body: response, bodyBytes }));
  const transport = { getBoundedJson } as unknown as AnyHarnessTransport;
  return { client: new SessionsClient(transport), getBoundedJson };
}

function exactSessionOptions() {
  return {
    mode: "exact" as const,
    sessionId: "session-1",
    updatedAtTo: timestampTo,
    limit: 1 as const,
    maxResponseBytes: 1_048_576 as const,
    request: {} as AnyHarnessRequestOptions,
  };
}

function sessionWindow(items: unknown[], itemLimit = 1) {
  return {
    window: {
      schemaVersion: 1,
      selection: "newest_matching",
      presentationOrder: "updated_desc_id_asc",
      itemLimit,
      responseByteLimit: 1_048_576,
      returnedItems: items.length,
      omittedOversizedItems: 0,
      completeness: "complete",
    },
    items,
  };
}

function evidenceWindow(items: unknown[], itemLimit: number, responseByteLimit: number) {
  return {
    window: {
      schemaVersion: 1,
      selection: "newest_matching",
      presentationOrder: "seq_asc",
      itemLimit,
      responseByteLimit,
      returnedItems: items.length,
      omittedOversizedItems: 0,
      completeness: "complete",
    },
    items,
  };
}

function sessionResponse() {
  return {
    agentKind: "codex",
    createdAt: "2026-08-12T12:00:00Z",
    id: "session-1",
    mcpBindingSummaries: null,
    modeId: "code",
    modelId: null,
    status: "running",
    title: "Session",
    updatedAt: "2026-08-12T12:00:00Z",
    workspaceId: "workspace-1",
  };
}

function eventResponse() {
  return {
    sessionId: "session-1",
    seq: 1,
    timestamp: timestampFrom,
    turnId: null,
    itemId: null,
    event: { type: "turn_started" },
  };
}

function rawNotificationResponse() {
  return {
    sessionId: "session-1",
    seq: 1,
    timestamp: timestampFrom,
    notificationKind: "session/update",
    notification: { message: "visible evidence" },
  };
}
