import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AnyHarnessClient,
  setAnyHarnessTimingObserver,
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
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
