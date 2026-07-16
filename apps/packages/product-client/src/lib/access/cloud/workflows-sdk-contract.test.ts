import { describe, expect, it, vi } from "vitest";

import {
  cancelWorkflowInvocation,
  deliverWorkflowInvocation,
  getWorkflowInvocation,
  listWorkflowInvocationHistory,
} from "@proliferate/cloud-sdk/client/workflows";
import type { ProliferateCloudClient } from "@proliferate/cloud-sdk/client/core";

describe("managed Workflow Cloud SDK contract", () => {
  it("pins detail, deliver, cancel, and cursor-scoped history requests", async () => {
    const requests: unknown[] = [];
    const requestJson = vi.fn(async (request: unknown) => {
      requests.push(request);
      return {};
    });
    const client = { requestJson } as unknown as ProliferateCloudClient;

    await getWorkflowInvocation("invocation-a", client);
    await deliverWorkflowInvocation("invocation-a", client);
    await cancelWorkflowInvocation("invocation-a", client);
    await listWorkflowInvocationHistory("definition-a", "cursor-a", client);

    expect(requests).toEqual([
      {
        method: "GET",
        path: "/v1/workflow-invocations/{invocation_id}",
        pathParams: { invocation_id: "invocation-a" },
      },
      {
        method: "POST",
        path: "/v1/workflow-invocations/{invocation_id}/deliver",
        pathParams: { invocation_id: "invocation-a" },
      },
      {
        method: "POST",
        path: "/v1/workflow-invocations/{invocation_id}/cancel",
        pathParams: { invocation_id: "invocation-a" },
      },
      {
        method: "GET",
        path: "/v1/workflow-invocations",
        query: { workflowDefinitionId: "definition-a", cursor: "cursor-a" },
      },
    ]);
  });

  it("omits an absent history cursor rather than serializing undefined", async () => {
    const requestJson = vi.fn(async (_request: unknown) => ({}));
    const client = { requestJson } as unknown as ProliferateCloudClient;

    await listWorkflowInvocationHistory("definition-a", undefined, client);

    expect(requestJson).toHaveBeenCalledWith({
      method: "GET",
      path: "/v1/workflow-invocations",
      query: { workflowDefinitionId: "definition-a" },
    });
  });
});
