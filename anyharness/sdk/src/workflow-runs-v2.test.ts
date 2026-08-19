import { describe, expect, it, vi } from "vitest";

import { AnyHarnessError, AnyHarnessTransport } from "./client/core.js";
import type { AnyHarnessRequestOptions, AnyHarnessTransport as Transport } from "./client/core.js";
import { WorkflowRunsV2Client } from "./client/workflow-runs-v2.js";
import type { WorkflowRunsListResponseV2 } from "./client/workflow-runs-v2.js";
import type {
  WorkflowRunFlipTypeRequestV2,
  WorkflowRunNodeSessionV2,
  WorkflowRunNodeV2,
  WorkflowRunProjectionV2,
  WorkflowRunPutRequestV2,
  WorkflowRunV2,
} from "./types/workflow-runs-v2.js";

function run(overrides: Partial<WorkflowRunV2> = {}): WorkflowRunV2 {
  return {
    id: "run-1",
    invocationId: "invocation-1",
    definitionJson: "{}",
    argumentsJson: "{}",
    workspaceId: "workspace-1",
    status: "running",
    currentNodeRowId: null,
    failureCode: null,
    interruptionCode: null,
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

function projection(overrides: Partial<WorkflowRunV2> = {}): WorkflowRunProjectionV2 {
  return {
    run: run(overrides),
    nodes: [],
    docs: [],
  };
}

function node(overrides: Partial<WorkflowRunNodeV2> & { id: string }): WorkflowRunNodeV2 {
  return {
    runId: "run-1",
    definitionNodeId: overrides.id,
    kind: "defined",
    nodeType: "agent",
    replacesNodeRowId: null,
    anchorNodeRowId: null,
    chainIndex: 0,
    title: overrides.id,
    prompt: "",
    status: "running",
    sessionId: null,
    promptId: null,
    failureCode: null,
    createdAt: "2026-08-14T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

describe("WorkflowRunsV2Client.putRun", () => {
  it("PUTs the frozen invocation_json verbatim and returns the projection", async () => {
    const calls: Array<{ path: string; body: unknown; options: AnyHarnessRequestOptions | undefined }> = [];
    const response = projection();
    const transport = {
      put: async (path: string, body: unknown, options?: AnyHarnessRequestOptions) => {
        calls.push({ path, body, options });
        return response;
      },
    } as unknown as Transport;
    const client = new WorkflowRunsV2Client(transport);

    const body: WorkflowRunPutRequestV2 = {
      schemaVersion: 2,
      workflowDefinitionId: "def-1",
      definition: {
        schemaVersion: 2,
        nodes: [],
        edges: [],
        inputs: [],
        docTemplates: [],
      },
      arguments: {},
      placement: { repoConfigId: "repo-1", mode: "worktree" },
    };

    const result = await client.putRun("run-1", body);

    expect(calls).toEqual([{
      path: "/v1/workflow-runs/run-1",
      body,
      options: undefined,
    }]);
    expect(result).toBe(response);
  });

  it("URL-encodes the run id", async () => {
    const calls: string[] = [];
    const transport = {
      put: async (path: string) => {
        calls.push(path);
        return projection();
      },
    } as unknown as Transport;
    const client = new WorkflowRunsV2Client(transport);

    await client.putRun("run/with slash", {
      schemaVersion: 2,
      workflowDefinitionId: "def-1",
      definition: { schemaVersion: 2, nodes: [], edges: [], inputs: [], docTemplates: [] },
      arguments: {},
      placement: { repoConfigId: "repo-1", mode: "repo_root" },
    });

    expect(calls).toEqual(["/v1/workflow-runs/run%2Fwith%20slash"]);
  });
});

describe("WorkflowRunsV2Client.getRun", () => {
  it("GETs the run projection and passes it through unchanged", async () => {
    const calls: string[] = [];
    const response = projection();
    const transport = {
      get: async (path: string) => {
        calls.push(path);
        return response;
      },
    } as unknown as Transport;
    const client = new WorkflowRunsV2Client(transport);

    const result = await client.getRun("run-1");

    expect(calls).toEqual(["/v1/workflow-runs/run-1"]);
    expect(result).toBe(response);
  });
});

describe("WorkflowRunsV2Client.listRuns", () => {
  it("lists every run when no workspace id is given", async () => {
    const calls: string[] = [];
    const response: WorkflowRunsListResponseV2 = { runs: [run()] };
    const transport = {
      get: async (path: string) => {
        calls.push(path);
        return response;
      },
    } as unknown as Transport;
    const client = new WorkflowRunsV2Client(transport);

    const result = await client.listRuns();

    expect(calls).toEqual(["/v1/workflow-runs"]);
    expect(result).toBe(response);
  });

  it("scopes the list to a workspace id when one is given", async () => {
    const calls: string[] = [];
    const response: WorkflowRunsListResponseV2 = { runs: [run()] };
    const transport = {
      get: async (path: string) => {
        calls.push(path);
        return response;
      },
    } as unknown as Transport;
    const client = new WorkflowRunsV2Client(transport);

    await client.listRuns("workspace-1");

    expect(calls).toEqual(["/v1/workflow-runs?workspace_id=workspace-1"]);
  });
});

describe("WorkflowRunsV2Client node commands", () => {
  it("approves a node with an empty body", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const response = projection();
    const transport = {
      post: async (path: string, body: unknown) => {
        calls.push({ path, body });
        return response;
      },
    } as unknown as Transport;
    const client = new WorkflowRunsV2Client(transport);

    const result = await client.approve("run-1", "node-1");

    expect(calls).toEqual([{
      path: "/v1/workflow-runs/run-1/nodes/node-1/approve",
      body: {},
    }]);
    expect(result).toBe(response);
  });

  it("posts fail-redo with the optional prompt override", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const transport = {
      post: async (path: string, body: unknown) => {
        calls.push({ path, body });
        return projection();
      },
    } as unknown as Transport;
    const client = new WorkflowRunsV2Client(transport);

    await client.failRedo("run-1", "node-1", { prompt: "retry with more care" });

    expect(calls).toEqual([{
      path: "/v1/workflow-runs/run-1/nodes/node-1/fail-redo",
      body: { prompt: "retry with more care" },
    }]);
  });

  it("posts the exact flip-type path and node-type body", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const transport = {
      post: async (path: string, body: unknown) => {
        calls.push({ path, body });
        return projection();
      },
    } as unknown as Transport;
    const client = new WorkflowRunsV2Client(transport);
    const body: WorkflowRunFlipTypeRequestV2 = { nodeType: "human_in_loop" };

    await client.flipType("run-1", "node-1", body);

    expect(calls).toEqual([{
      path: "/v1/workflow-runs/run-1/nodes/node-1/type",
      body,
    }]);
  });

  it("does not accept the fail-redo path for flip-type (negative control)", async () => {
    const calls: string[] = [];
    const transport = {
      post: async (path: string) => {
        calls.push(path);
        return projection();
      },
    } as unknown as Transport;
    const client = new WorkflowRunsV2Client(transport);

    await client.flipType("run-1", "node-1", { nodeType: "agent" });

    expect(calls).not.toEqual(["/v1/workflow-runs/run-1/nodes/node-1/fail-redo"]);
    expect(calls).toEqual(["/v1/workflow-runs/run-1/nodes/node-1/type"]);
  });
});

describe("WorkflowRunsV2Client run-level commands", () => {
  it("posts undo-advance with an empty body", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const transport = {
      post: async (path: string, body: unknown) => {
        calls.push({ path, body });
        return projection();
      },
    } as unknown as Transport;
    const client = new WorkflowRunsV2Client(transport);

    await client.undoAdvance("run-1");

    expect(calls).toEqual([{ path: "/v1/workflow-runs/run-1/undo-advance", body: {} }]);
  });

  it("posts resume with an empty body", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const transport = {
      post: async (path: string, body: unknown) => {
        calls.push({ path, body });
        return projection();
      },
    } as unknown as Transport;
    const client = new WorkflowRunsV2Client(transport);

    await client.resume("run-1");

    expect(calls).toEqual([{ path: "/v1/workflow-runs/run-1/resume", body: {} }]);
  });

  it("posts the adhoc node body to the adhoc-nodes collection", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const transport = {
      post: async (path: string, body: unknown) => {
        calls.push({ path, body });
        return projection();
      },
    } as unknown as Transport;
    const client = new WorkflowRunsV2Client(transport);

    await client.addAdhocNode("run-1", {
      anchorNodeRowId: "node-1",
      prompt: "investigate the flake",
    });

    expect(calls).toEqual([{
      path: "/v1/workflow-runs/run-1/adhoc-nodes",
      body: { anchorNodeRowId: "node-1", prompt: "investigate the flake" },
    }]);
  });
});

describe("WorkflowRunNodeV2 sessions rollup contract (ruling F4)", () => {
  // A runtime that emits the rung-7 rollup: one entry per leg, ordered by
  // legIndex, `failed` carrying its code in the sibling field.
  const parallelNode: WorkflowRunNodeV2 = node({
    id: "review",
    sessions: [
      { legIndex: 0, sessionId: "sess-a", status: "done", failureCode: null, completedAt: "2026-08-14T00:01:00.000Z" },
      { legIndex: 1, sessionId: "sess-b", status: "failed", failureCode: "turn_error", completedAt: "2026-08-14T00:02:00.000Z" },
      { legIndex: 2, sessionId: "sess-c", status: "running", failureCode: null, completedAt: null },
    ],
  });
  // A runtime that predates the rollup: no `sessions` key at all, still a valid
  // WorkflowRunNodeV2 (the field is optional). This is the back-compat fixture.
  const legacyNode: WorkflowRunNodeV2 = node({ id: "solo", sessionId: "sess-only" });

  it("passes a node carrying the per-leg rollup through getRun unchanged", async () => {
    const response: WorkflowRunProjectionV2 = { run: run(), nodes: [parallelNode], docs: [] };
    const transport = {
      get: async () => response,
    } as unknown as Transport;
    const client = new WorkflowRunsV2Client(transport);

    const result = await client.getRun("run-1");

    expect(result.nodes[0]!.sessions).toEqual(parallelNode.sessions);
    const sessions = result.nodes[0]!.sessions as WorkflowRunNodeSessionV2[];
    expect(sessions.map((leg) => leg.legIndex)).toEqual([0, 1, 2]);
    expect(sessions[1]).toMatchObject({ status: "failed", failureCode: "turn_error" });
  });

  it("accepts a legacy node with no sessions key and leaves it undefined", async () => {
    const response: WorkflowRunProjectionV2 = { run: run(), nodes: [legacyNode], docs: [] };
    const transport = {
      get: async () => response,
    } as unknown as Transport;
    const client = new WorkflowRunsV2Client(transport);

    const result = await client.getRun("run-1");

    expect(result.nodes[0]!.sessions).toBeUndefined();
    // The scalar representative session is the back-compat fall-back.
    expect(result.nodes[0]!.sessionId).toBe("sess-only");
  });
});

describe("WorkflowRunsV2Client ProblemDetails errors", () => {
  it("surfaces WORKFLOW_TRANSITION_ILLEGAL through the real transport", async () => {
    const response = new Response(
      JSON.stringify({
        type: "about:blank",
        title: "Illegal transition",
        status: 409,
        detail: "node is not awaiting human review",
        code: "WORKFLOW_TRANSITION_ILLEGAL",
      }),
      {
        status: 409,
        statusText: "Conflict",
        headers: { "content-type": "application/problem+json" },
      },
    );
    const transport = new AnyHarnessTransport({
      baseUrl: "http://runtime.test",
      fetch: vi.fn(async () => response) as typeof globalThis.fetch,
    });
    const client = new WorkflowRunsV2Client(transport);

    try {
      await client.approve("run-1", "node-1");
      throw new Error("expected approve to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(AnyHarnessError);
      expect((error as AnyHarnessError).problem.code).toBe("WORKFLOW_TRANSITION_ILLEGAL");
      expect((error as AnyHarnessError).problem.status).toBe(409);
      expect((error as AnyHarnessError).message).toBe("node is not awaiting human review");
    }
  });
});
