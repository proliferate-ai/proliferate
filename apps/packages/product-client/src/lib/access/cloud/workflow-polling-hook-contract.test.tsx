// @vitest-environment jsdom

import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { ProliferateCloudClient } from "@proliferate/cloud-sdk";
import { CloudClientProvider } from "@proliferate/cloud-sdk-react/context/CloudClientProvider";
import { useWorkflowRun } from "@proliferate/cloud-sdk-react/hooks/workflows";
import { workflowRunDetailKey } from "@proliferate/cloud-sdk-react/lib/query-keys";

describe("managed Workflow polling hook", () => {
  it("wires the exact cadence and stops for terminal or target-lost projections", async () => {
    const client = {
      baseUrl: "https://cloud.example",
      requestJson: vi.fn().mockResolvedValue(run("queued", null, "pending")),
    } as unknown as ProliferateCloudClient;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <CloudClientProvider client={client}>{children}</CloudClientProvider>
      </QueryClientProvider>
    );
    const { result, unmount } = renderHook(
      () => useWorkflowRun("definition-a", "run-a", "user-a"),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const key = workflowRunDetailKey(
      "https://cloud.example",
      "user-a",
      "definition-a",
      "run-a",
    );
    const query = queryClient.getQueryCache().find({ queryKey: key });
    if (!query) throw new Error("workflow run query missing");
    const interval = (query.options as {
      refetchInterval?: number | false | ((query: unknown) => number | false);
    }).refetchInterval;
    expect(typeof interval).toBe("function");
    if (typeof interval !== "function") throw new Error("polling callback missing");
    expect(interval(query)).toBe(3_000);

    queryClient.setQueryData(key, run("accepted", "completed", "live"));
    expect(interval(query)).toBe(false);
    queryClient.setQueryData(key, run("accepted", "running", "target_lost"));
    expect(interval(query)).toBe(false);

    unmount();
    queryClient.clear();
  });
});

function run(
  deliveryStatus: string,
  executionStatus: string | null,
  freshnessStatus: string,
) {
  return {
    id: "run-a",
    workflowDefinitionId: "definition-a",
    managedExecution: {
      deliveryStatus,
      execution: executionStatus ? { status: executionStatus, cancelRequestedAt: null } : null,
      freshness: { status: freshnessStatus },
    },
  };
}
