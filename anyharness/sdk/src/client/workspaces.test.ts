import { describe, expect, it } from "vitest";

import type { AnyHarnessTransport } from "./core.js";
import { WorkspacesClient } from "./workspaces.js";

describe("WorkspacesClient workspace URLs", () => {
  it("encodes workspace ids for the subagent roster", async () => {
    const calls: string[] = [];
    const transport = {
      get: async (path: string) => {
        calls.push(path);
        return { workspaceId: "workspace/1", parents: [] };
      },
    } as unknown as AnyHarnessTransport;
    const client = new WorkspacesClient(transport);

    await client.listSubagents("workspace/1");

    expect(calls).toEqual(["/v1/workspaces/workspace%2F1/subagents"]);
  });

  it("encodes worktree restore workspace ids and sends no request body", async () => {
    const calls: Array<{ path: string; body: unknown; timingCategory?: string }> = [];
    const transport = {
      post: async (
        path: string,
        body: unknown,
        options?: { timingCategory?: string },
      ) => {
        calls.push({ path, body, timingCategory: options?.timingCategory });
        return { outcome: "restored" };
      },
    } as unknown as AnyHarnessTransport;
    const client = new WorkspacesClient(transport);

    await client.restoreWorktree("workspace/1");

    expect(calls).toEqual([{
      path: "/v1/workspaces/workspace%2F1/worktree/restore",
      body: undefined,
      timingCategory: "workspace.worktree.restore",
    }]);
  });

});
