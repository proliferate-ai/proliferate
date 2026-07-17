// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useWorkspaceAgentCatalog } from "#product/hooks/agents/derived/use-workspace-agent-catalog";

const mocks = vi.hoisted(() => ({
  agentsRefetch: vi.fn(),
  reconcileDataUpdatedAt: 0,
  reconcileSnapshot: null as null | { jobId?: string | null; status: string },
  useWorkspaceAgentReconcileStatusQuery: vi.fn(),
  useWorkspaceAgentsQuery: vi.fn(),
}));

vi.mock("@anyharness/sdk-react", () => ({
  useWorkspaceAgentReconcileStatusQuery: mocks.useWorkspaceAgentReconcileStatusQuery,
  useWorkspaceAgentsQuery: mocks.useWorkspaceAgentsQuery,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.reconcileDataUpdatedAt = 0;
  mocks.reconcileSnapshot = null;
});

it("retries failed terminal refreshes and records only successful jobs", async () => {
  arrange();
  const { rerender } = renderHook(() => useWorkspaceAgentCatalog({ enabled: true }));
  expect(mocks.useWorkspaceAgentReconcileStatusQuery).toHaveBeenCalledWith({
    enabled: true,
    discoverWhileIdle: true,
  });

  mocks.agentsRefetch
    .mockResolvedValueOnce({
      error: new Error("transient refresh failure"),
      isError: true,
    })
    .mockResolvedValue({ isError: false });
  mocks.reconcileDataUpdatedAt = 1;
  mocks.reconcileSnapshot = { jobId: "job-a", status: "completed" };
  rerender();
  await waitFor(() => expect(mocks.agentsRefetch).toHaveBeenCalledTimes(1));

  mocks.reconcileDataUpdatedAt = 2;
  mocks.reconcileSnapshot = { jobId: "job-a", status: "completed" };
  rerender();
  await waitFor(() => expect(mocks.agentsRefetch).toHaveBeenCalledTimes(2));

  mocks.reconcileDataUpdatedAt = 3;
  mocks.reconcileSnapshot = { jobId: "job-a", status: "completed" };
  rerender();
  expect(mocks.agentsRefetch).toHaveBeenCalledTimes(2);

  mocks.reconcileDataUpdatedAt = 4;
  mocks.reconcileSnapshot = { jobId: "job-b", status: "failed" };
  rerender();
  await waitFor(() => expect(mocks.agentsRefetch).toHaveBeenCalledTimes(3));

  mocks.reconcileDataUpdatedAt = 5;
  mocks.reconcileSnapshot = { status: "running" };
  rerender();
  mocks.reconcileDataUpdatedAt = 6;
  mocks.reconcileSnapshot = { status: "completed" };
  rerender();
  await waitFor(() => expect(mocks.agentsRefetch).toHaveBeenCalledTimes(4));
});

function arrange() {
  mocks.agentsRefetch.mockResolvedValue(undefined);
  mocks.useWorkspaceAgentsQuery.mockImplementation(() => ({
    data: [],
    refetch: mocks.agentsRefetch,
  }));
  mocks.useWorkspaceAgentReconcileStatusQuery.mockImplementation(() => ({
    data: mocks.reconcileSnapshot,
    dataUpdatedAt: mocks.reconcileDataUpdatedAt,
  }));
}
