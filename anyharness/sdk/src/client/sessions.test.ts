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
      { mcpServers: [], mcpBindingSummaries: [] },
      { headers: { "x-trace": "trace-2" } },
    );

    expect(calls).toEqual([{
      path: "/v1/sessions/session-1/resume",
      body: { mcpServers: [], mcpBindingSummaries: [] },
      options: { headers: { "x-trace": "trace-2" } },
    }]);
  });
});
