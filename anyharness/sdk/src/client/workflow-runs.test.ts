import { describe, expect, it } from "vitest";

import type {
  VersionedPutWorkflowRunRequest,
  VersionedWorkflowRunResponse,
} from "../types/workflow-runs.js";
import type { AnyHarnessTransport } from "./core.js";
import { WorkflowRunsClient } from "./workflow-runs.js";

const RUN_ID = "11111111-2222-3333-4444-555555555555";

const RESPONSE: VersionedWorkflowRunResponse = {
  run: {
    id: RUN_ID,
    status: "running",
    workspaceId: "local-workspace-123",
  } as VersionedWorkflowRunResponse["run"],
  steps: [],
} as VersionedWorkflowRunResponse;

const PUT_REQUEST: VersionedPutWorkflowRunRequest = {
  schemaVersion: 2,
  workspaceId: "local-workspace-123",
  definition: {
    inputs: [{ name: "ticket", type: "string", required: true }],
    stages: [
      {
        harnessConfig: {
          agentKind: "claude",
          modelSelection: { kind: "targetDefault" },
          permissionPolicy: "workflowDefault",
        },
        steps: [{ kind: "agent.prompt", prompt: "Investigate {{inputs.ticket}}" }],
      },
    ],
  },
  arguments: { ticket: "PROL-123" },
};

describe("WorkflowRunsClient", () => {
  it("PUTs the versioned request to the canonical run path", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const transport = {
      put: async (path: string, body: unknown) => {
        calls.push({ path, body });
        return RESPONSE;
      },
    } as unknown as AnyHarnessTransport;
    const client = new WorkflowRunsClient(transport);

    const result = await client.put(RUN_ID, PUT_REQUEST);

    expect(calls).toEqual([{ path: `/v1/workflow-runs/${RUN_ID}`, body: PUT_REQUEST }]);
    expect(result).toBe(RESPONSE);
  });

  it("URL-encodes the run ID on GET", async () => {
    const calls: string[] = [];
    const transport = {
      get: async (path: string) => {
        calls.push(path);
        return RESPONSE;
      },
    } as unknown as AnyHarnessTransport;
    const client = new WorkflowRunsClient(transport);

    await client.get("run/with slash");

    expect(calls).toEqual(["/v1/workflow-runs/run%2Fwith%20slash"]);
  });

  it("POSTs to the cancel subresource with an empty body", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const transport = {
      post: async (path: string, body: unknown) => {
        calls.push({ path, body });
        return RESPONSE;
      },
    } as unknown as AnyHarnessTransport;
    const client = new WorkflowRunsClient(transport);

    await client.cancel(RUN_ID);

    expect(calls).toEqual([{ path: `/v1/workflow-runs/${RUN_ID}/cancel`, body: {} }]);
  });
});
