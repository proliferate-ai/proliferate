import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AnyHarnessClient,
  setAnyHarnessTimingObserver,
  type AnyHarnessRequestStartEvent,
  type AnyHarnessTimingEvent,
} from "./core.js";

const originalFetch = globalThis.fetch;

describe("AnyHarness timing observer", () => {
  afterEach(() => {
    setAnyHarnessTimingObserver(null);
    globalThis.fetch = originalFetch;
  });

  it("is disabled by default", async () => {
    const fetch = vi.fn(async () => jsonResponse([]));
    const client = new AnyHarnessClient({
      baseUrl: "http://runtime.test",
      fetch: fetch as typeof globalThis.fetch,
    });

    await client.workspaces.list();

    expect(fetch).toHaveBeenCalledOnce();
  });

  it("emits a static category without caller options", async () => {
    const events: AnyHarnessTimingEvent[] = [];
    setAnyHarnessTimingObserver((event) => events.push(event));
    const client = new AnyHarnessClient({
      baseUrl: "http://runtime.test",
      fetch: vi.fn(async () => jsonResponse([])) as typeof globalThis.fetch,
    });

    await client.workspaces.list();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "request",
      category: "workspace.list",
      method: "GET",
      status: 200,
    });
    expect(events[0]).not.toHaveProperty("path");
    expect(events[0]).not.toHaveProperty("url");
    expect(events[0]).not.toHaveProperty("body");
  });

  it("emits workspace get timing without endpoint details", async () => {
    const events: AnyHarnessTimingEvent[] = [];
    setAnyHarnessTimingObserver((event) => events.push(event));
    const client = new AnyHarnessClient({
      baseUrl: "http://runtime.test",
      fetch: vi.fn(async () => jsonResponse({
        id: "workspace-1",
        path: "/repo",
      })) as typeof globalThis.fetch,
    });

    await client.workspaces.get("workspace-1");

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "request",
      category: "workspace.get",
      method: "GET",
      status: 200,
    });
    expect(events[0]).not.toHaveProperty("path");
    expect(events[0]).not.toHaveProperty("url");
  });

  it("allows multiple timing observers to coexist", async () => {
    const firstEvents: AnyHarnessTimingEvent[] = [];
    const secondEvents: AnyHarnessTimingEvent[] = [];
    const cleanupFirst = setAnyHarnessTimingObserver((event) => firstEvents.push(event));
    const cleanupSecond = setAnyHarnessTimingObserver((event) => secondEvents.push(event));
    const client = new AnyHarnessClient({
      baseUrl: "http://runtime.test",
      fetch: vi.fn(async () => jsonResponse([])) as typeof globalThis.fetch,
    });

    await client.workspaces.list();
    cleanupSecond();
    await client.workspaces.list();
    cleanupFirst();
    await client.workspaces.list();

    expect(firstEvents).toHaveLength(2);
    expect(secondEvents).toHaveLength(1);
  });

  it("preserves caller headers and adds measurement attribution", async () => {
    const events: AnyHarnessTimingEvent[] = [];
    setAnyHarnessTimingObserver((event) => events.push(event));
    const fetch = vi.fn(async (_input, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("x-trace")).toBe("trace-1");
      expect(headers.get("x-proliferate-measurement-operation-id")).toBe("mop_test");
      return jsonResponse([]);
    });
    const client = new AnyHarnessClient({
      baseUrl: "http://runtime.test",
      fetch: fetch as typeof globalThis.fetch,
    });

    await client.workspaces.list({
      headers: {
        "x-trace": "trace-1",
        "x-proliferate-measurement-operation-id": "mop_test",
      },
      measurementOperationId: "mop_test",
    });

    expect(events[0]).toMatchObject({
      type: "request",
      category: "workspace.list",
      measurementOperationId: "mop_test",
    });
  });

  it("notifies sanitized request lifecycle around timed fetches", async () => {
    const events: AnyHarnessTimingEvent[] = [];
    const lifecycleEvents: AnyHarnessRequestStartEvent[] = [];
    const order: string[] = [];
    const finish = vi.fn(() => order.push("finish"));
    setAnyHarnessTimingObserver((event) => {
      order.push("timing");
      events.push(event);
    });
    const fetch = vi.fn(async () => {
      order.push("fetch");
      expect(order).toEqual(["start", "fetch"]);
      return jsonResponse([]);
    });
    const client = new AnyHarnessClient({
      baseUrl: "http://runtime.test",
      fetch: fetch as typeof globalThis.fetch,
    });

    await client.workspaces.list({
      measurementOperationId: "mop_test",
      timingLifecycle: {
        onRequestStart: (event) => {
          order.push("start");
          lifecycleEvents.push(event);
          return finish;
        },
      },
    });

    expect(lifecycleEvents).toHaveLength(1);
    expect(lifecycleEvents[0]).toMatchObject({
      type: "request_start",
      category: "workspace.list",
      method: "GET",
      measurementOperationId: "mop_test",
    });
    expect(events).toHaveLength(1);
    expect(finish).toHaveBeenCalledOnce();
    expect(order).toEqual(["start", "fetch", "timing", "finish"]);
    expectTimingEventSanitized(lifecycleEvents[0]);
  });

  it("emits git diff timing without endpoint or diff details", async () => {
    const events: AnyHarnessTimingEvent[] = [];
    setAnyHarnessTimingObserver((event) => events.push(event));
    const client = new AnyHarnessClient({
      baseUrl: "http://runtime.test",
      fetch: vi.fn(async () => jsonResponse({
        path: "secret-file.ts",
        scope: "branch",
        binary: false,
        truncated: false,
        additions: 1,
        deletions: 0,
        patch: "@@ secret patch @@",
      })) as typeof globalThis.fetch,
    });

    await client.git.getDiff("workspace-1", "secret-file.ts", {
      scope: "branch",
      baseRef: "origin/private",
      request: { measurementOperationId: "mop_test" },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "request",
      category: "git.diff",
      method: "GET",
      status: 200,
      measurementOperationId: "mop_test",
    });
    expectTimingEventSanitized(events[0]);
  });

  it("emits branch diff file timing without endpoint or ref details", async () => {
    const events: AnyHarnessTimingEvent[] = [];
    setAnyHarnessTimingObserver((event) => events.push(event));
    const client = new AnyHarnessClient({
      baseUrl: "http://runtime.test",
      fetch: vi.fn(async () => jsonResponse({
        baseRef: "origin/private",
        resolvedBaseOid: "base",
        mergeBaseOid: "merge",
        headOid: "head",
        files: [],
      })) as typeof globalThis.fetch,
    });

    await client.git.listBranchDiffFiles("workspace-1", {
      baseRef: "origin/private",
      request: { measurementOperationId: "mop_test" },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "request",
      category: "git.branch_diff_files",
      method: "GET",
      status: 200,
      measurementOperationId: "mop_test",
    });
    expectTimingEventSanitized(events[0]);
  });

  it("emits git diff timing on HTTP errors", async () => {
    const events: AnyHarnessTimingEvent[] = [];
    setAnyHarnessTimingObserver((event) => events.push(event));
    const client = new AnyHarnessClient({
      baseUrl: "http://runtime.test",
      fetch: vi.fn(async () => problemResponse(500)) as typeof globalThis.fetch,
    });

    await expect(client.git.getDiff("workspace-1", "secret-file.ts", {
      request: { measurementOperationId: "mop_test" },
    })).rejects.toThrow();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "request",
      category: "git.diff",
      method: "GET",
      status: 500,
      measurementOperationId: "mop_test",
    });
    expectTimingEventSanitized(events[0]);
  });

  it("emits git diff timing on network errors", async () => {
    const events: AnyHarnessTimingEvent[] = [];
    setAnyHarnessTimingObserver((event) => events.push(event));
    const client = new AnyHarnessClient({
      baseUrl: "http://runtime.test",
      fetch: vi.fn(async () => {
        throw new Error("network down");
      }) as typeof globalThis.fetch,
    });

    await expect(client.git.getDiff("workspace-1", "secret-file.ts", {
      request: { measurementOperationId: "mop_test" },
    })).rejects.toThrow("network down");

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "request",
      category: "git.diff",
      method: "GET",
      status: "network_error",
      measurementOperationId: "mop_test",
    });
    expectTimingEventSanitized(events[0]);
  });

  it("emits git diff timing on aborts", async () => {
    const events: AnyHarnessTimingEvent[] = [];
    setAnyHarnessTimingObserver((event) => events.push(event));
    const client = new AnyHarnessClient({
      baseUrl: "http://runtime.test",
      fetch: vi.fn(async () => {
        throw new DOMException("Aborted", "AbortError");
      }) as typeof globalThis.fetch,
    });
    const controller = new AbortController();

    await expect(client.git.getDiff("workspace-1", "secret-file.ts", {
      request: {
        measurementOperationId: "mop_test",
        signal: controller.signal,
      },
    })).rejects.toThrow();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "request",
      category: "git.diff",
      method: "GET",
      status: "aborted",
      measurementOperationId: "mop_test",
    });
    expectTimingEventSanitized(events[0]);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function problemResponse(status: number): Response {
  return new Response(JSON.stringify({
    type: "about:blank",
    title: "Request failed",
    status,
    detail: "sanitized failure",
  }), {
    status,
    headers: { "content-type": "application/problem+json" },
  });
}

function expectTimingEventSanitized(event: AnyHarnessTimingEvent | AnyHarnessRequestStartEvent): void {
  const serialized = JSON.stringify(event);
  expect(serialized).not.toContain("/v1/");
  expect(serialized).not.toContain("secret-file");
  expect(serialized).not.toContain("origin/private");
  expect(serialized).not.toContain("@@ secret patch @@");
  expect(event).not.toHaveProperty("path");
  expect(event).not.toHaveProperty("url");
  expect(event).not.toHaveProperty("body");
}
