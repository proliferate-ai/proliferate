import { describe, expect, it } from "vitest";

import type { Session } from "../types/sessions.js";
import type { AnyHarnessRequestOptions, AnyHarnessTransport } from "./core.js";
import { SessionsClient } from "./sessions.js";

function sessionResponse(): Session {
  return {
    agentKind: "codex",
    createdAt: "2026-04-19T00:00:00.000Z",
    id: "session-1",
    mcpBindingSummaries: null,
    modeId: "code",
    modelId: null,
    status: "running",
    title: "Session",
    updatedAt: "2026-04-19T00:00:00.000Z",
    workspaceId: "workspace-1",
  };
}

describe("SessionsClient.resume", () => {

  it("preserves the old options-only overload", async () => {
    const calls: Array<{
      body: unknown;
      options: AnyHarnessRequestOptions | undefined;
      path: string;
    }> = [];
    const transport = {
      post: async (path: string, body: unknown, options?: AnyHarnessRequestOptions) => {
        calls.push({ path, body, options });
        return sessionResponse();
      },
    } as unknown as AnyHarnessTransport;
    const client = new SessionsClient(transport);

    await client.resume("session-1", { headers: { "x-trace": "trace-1" } });

    expect(calls).toEqual([{
      path: "/v1/sessions/session-1/resume",
      body: {},
      options: { headers: { "x-trace": "trace-1" } },
    }]);
  });

  it("treats timing-only options as request options", async () => {
    const calls: Array<{
      body: unknown;
      options: AnyHarnessRequestOptions | undefined;
      path: string;
    }> = [];
    const transport = {
      post: async (path: string, body: unknown, options?: AnyHarnessRequestOptions) => {
        calls.push({ path, body, options });
        return sessionResponse();
      },
    } as unknown as AnyHarnessTransport;
    const client = new SessionsClient(transport);

    await client.resume("session-1", {
      measurementOperationId: "mop_test",
      timingCategory: "session.stream",
    });

    expect(calls).toEqual([{
      path: "/v1/sessions/session-1/resume",
      body: {},
      options: {
        measurementOperationId: "mop_test",
        timingCategory: "session.stream",
      },
    }]);
  });

  it("keeps explicit resume body and request options distinct", async () => {
    const calls: Array<{
      body: unknown;
      options: AnyHarnessRequestOptions | undefined;
      path: string;
    }> = [];
    const transport = {
      post: async (path: string, body: unknown, options?: AnyHarnessRequestOptions) => {
        calls.push({ path, body, options });
        return sessionResponse();
      },
    } as unknown as AnyHarnessTransport;
    const client = new SessionsClient(transport);

    await client.resume(
      "session-1",
      {},
      { headers: { "x-trace": "trace-2" } },
    );

    expect(calls).toEqual([{
      path: "/v1/sessions/session-1/resume",
      body: {},
      options: { headers: { "x-trace": "trace-2" } },
    }]);
  });
});

describe("SessionsClient.listEvents", () => {
  it("serializes oldest-first pagination", async () => {
    const calls: Array<{ path: string; options: AnyHarnessRequestOptions | undefined }> = [];
    const transport = {
      get: async (path: string, options?: AnyHarnessRequestOptions) => {
        calls.push({ path, options });
        return [];
      },
    } as unknown as AnyHarnessTransport;
    const client = new SessionsClient(transport);

    await client.listEvents("session-1", {
      afterSeq: 10,
      limit: 25,
      oldestFirst: true,
      request: { headers: { "x-trace": "trace-events" } },
    });

    expect(calls).toEqual([{
      path: "/v1/sessions/session-1/events?after_seq=10&limit=25&oldest_first=true",
      options: {
        headers: { "x-trace": "trace-events" },
        timingCategory: "session.events.list",
      },
    }]);
  });
});

describe("SessionsClient.reorderPendingPrompts", () => {
  it("sends both expected and desired queue order for CAS", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const transport = {
      put: async (path: string, body: unknown) => {
        calls.push({ path, body });
        return sessionResponse();
      },
    } as unknown as AnyHarnessTransport;
    const client = new SessionsClient(transport);

    await client.reorderPendingPrompts("session-1", {
      expectedSeqs: [1, 2, 3],
      desiredSeqs: [3, 1, 2],
    });

    expect(calls).toEqual([{
      path: "/v1/sessions/session-1/pending-prompts/order",
      body: {
        expectedSeqs: [1, 2, 3],
        desiredSeqs: [3, 1, 2],
      },
    }]);
  });
});
