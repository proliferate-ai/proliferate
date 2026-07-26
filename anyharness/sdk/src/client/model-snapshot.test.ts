import { describe, expect, it } from "vitest";

import type { AnyHarnessTransport } from "./core.js";
import { ModelSnapshotClient } from "./model-snapshot.js";

describe("ModelSnapshotClient.getStatus", () => {
  it("GETs the singular /model-snapshot route (never the plural)", async () => {
    const calls: string[] = [];
    const transport = {
      get: async (path: string) => {
        calls.push(path);
        return {};
      },
    } as unknown as AnyHarnessTransport;
    const client = new ModelSnapshotClient(transport);

    await client.getStatus("codex");

    expect(calls).toEqual(["/v1/agents/codex/model-snapshot"]);
  });

  it("URL-encodes the agent kind", async () => {
    const calls: string[] = [];
    const transport = {
      get: async (path: string) => {
        calls.push(path);
        return {};
      },
    } as unknown as AnyHarnessTransport;
    const client = new ModelSnapshotClient(transport);

    await client.getStatus("agent/kind with space");

    expect(calls).toEqual([
      "/v1/agents/agent%2Fkind%20with%20space/model-snapshot",
    ]);
  });
});

describe("ModelSnapshotClient.refresh", () => {
  it("POSTs to the /model-snapshot/refresh route with the camelCase authContextId query param", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const transport = {
      post: async (path: string, body: unknown) => {
        calls.push({ path, body });
        return {};
      },
    } as unknown as AnyHarnessTransport;
    const client = new ModelSnapshotClient(transport);

    await client.refresh("codex", "gateway");

    expect(calls).toEqual([
      {
        path: "/v1/agents/codex/model-snapshot/refresh?authContextId=gateway",
        body: {},
      },
    ]);
  });

  it("never renders the query param as snake_case auth_context_id (server pins this at the wire, router_tests.rs:1417-1462)", async () => {
    const calls: string[] = [];
    const transport = {
      post: async (path: string) => {
        calls.push(path);
        return {};
      },
    } as unknown as AnyHarnessTransport;
    const client = new ModelSnapshotClient(transport);

    await client.refresh("codex", "gateway");

    expect(calls[0]).not.toContain("auth_context_id");
    expect(calls[0]).toContain("authContextId=gateway");
  });

  it("URL-encodes both the agent kind and the auth context id", async () => {
    const calls: string[] = [];
    const transport = {
      post: async (path: string) => {
        calls.push(path);
        return {};
      },
    } as unknown as AnyHarnessTransport;
    const client = new ModelSnapshotClient(transport);

    await client.refresh("agent kind", "context/id");

    expect(calls).toEqual([
      "/v1/agents/agent%20kind/model-snapshot/refresh?authContextId=context%2Fid",
    ]);
  });
});
