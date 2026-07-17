// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProliferateClientError } from "@proliferate/cloud-sdk";
import type { WorkflowDefinition } from "@proliferate/product-domain/workflows/definition";
import { WorkflowDefinitionRunsPanel, WorkflowRunsSurface } from "./WorkflowRunsSurface";

class TestIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);

const cloud = vi.hoisted(() => ({
  put: vi.fn(),
  deliver: vi.fn(),
  cancel: vi.fn(),
  check: vi.fn(),
  useEligibility: vi.fn(),
  useRun: vi.fn(),
  useHistory: vi.fn(),
}));

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useWorkflowRunEligibility: cloud.useEligibility,
  useWorkflowRunHistory: cloud.useHistory,
  useWorkflowRun: cloud.useRun,
  useWorkflowRunActions: () => ({
    putWorkflowInvocation: cloud.put,
    deliverWorkflowInvocation: cloud.deliver,
    cancelWorkflowInvocation: cloud.cancel,
    checkWorkflowInvocation: cloud.check,
  }),
}));

const definition: WorkflowDefinition = {
  id: "10000000-0000-4000-8000-000000000001",
  userId: "user-1",
  title: "Triage",
  description: "",
  schemaVersion: 1,
  revision: 3,
  validatedCatalogVersion: "catalog-1",
  defaultRepoConfigId: null,
  inputs: [{ name: "ticket", type: "string", required: true }],
  stages: [{
    harnessConfig: { agentKind: "claude", modelId: null, effort: null },
    steps: [{ kind: "agent.prompt", prompt: "Investigate {{inputs.ticket}}", goal: null }],
  }],
  createdAt: "2026-07-16T00:00:00Z",
  updatedAt: "2026-07-16T00:00:00Z",
  deletedAt: null,
};

describe("Workflow managed run surfaces", () => {
  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
    vi.stubGlobal("crypto", { randomUUID: () => "40000000-0000-4000-8000-000000000001" });
    cloud.put.mockResolvedValue({ id: "40000000-0000-4000-8000-000000000001" });
    cloud.deliver.mockResolvedValue(runFixture());
    cloud.check.mockResolvedValue(runFixture());
    cloud.cancel.mockResolvedValue(runFixture());
    cloud.useEligibility.mockReturnValue({
      data: { eligible: true, blockers: [] },
      isLoading: false,
      isError: false,
    });
    cloud.useRun.mockReturnValue({ data: runFixture(), isLoading: false, isError: false, refetch: vi.fn() });
    cloud.useHistory.mockReturnValue({
      data: { pages: [{ items: [], nextCursor: null }] },
      isLoading: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("creates then delivers exactly once with one stable UUID", async () => {
    let acceptPut!: (value: { id: string }) => void;
    cloud.put.mockImplementationOnce(() => new Promise((resolve) => {
      acceptPut = resolve;
    }));
    const onOpenRun = vi.fn();
    render(
      <WorkflowDefinitionRunsPanel
        authCacheScope="user-1"
        definition={definition}
        managedRunsEnabled
        onOpenRun={onOpenRun}
      />,
    );
    fireEvent.change(screen.getByLabelText("ticket"), { target: { value: "PROL-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Run in Cloud" }));
    fireEvent.click(screen.getByRole("button", { name: "Run in Cloud" }));
    expect(cloud.put).toHaveBeenCalledTimes(1);
    acceptPut({ id: "40000000-0000-4000-8000-000000000001" });

    await waitFor(() => expect(onOpenRun).toHaveBeenCalledWith("40000000-0000-4000-8000-000000000001"));
    expect(cloud.put).toHaveBeenCalledTimes(1);
    expect(cloud.put).toHaveBeenCalledWith(expect.objectContaining({
      invocationId: "40000000-0000-4000-8000-000000000001",
      body: expect.objectContaining({
        workflowDefinitionId: definition.id,
        expectedRevision: 3,
        arguments: { ticket: "PROL-123" },
        target: { kind: "managedCloud" },
      }),
    }));
    expect(cloud.deliver).toHaveBeenCalledTimes(1);
    expect(cloud.deliver.mock.invocationCallOrder[0]).toBeGreaterThan(cloud.put.mock.invocationCallOrder[0]!);
  });

  it("retains the UUID after create response loss and retries the same request", async () => {
    cloud.put.mockRejectedValueOnce(new DOMException("timed out", "AbortError"));
    cloud.check.mockRejectedValueOnce(
      new ProliferateClientError("missing", 404, "workflow_invocation_not_found"),
    );
    const onOpenRun = vi.fn();
    render(
      <WorkflowDefinitionRunsPanel
        authCacheScope="user-1"
        definition={definition}
        managedRunsEnabled
        onOpenRun={onOpenRun}
      />,
    );
    fireEvent.change(screen.getByLabelText("ticket"), { target: { value: "PROL-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Run in Cloud" }));

    await screen.findByRole("button", { name: "Check or retry this run" });
    const launch = screen.getByRole("button", { name: "Run in Cloud" }) as HTMLButtonElement;
    expect(launch.disabled).toBe(true);
    fireEvent.click(launch);
    expect(cloud.put).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Check or retry this run" }));

    await waitFor(() => expect(onOpenRun).toHaveBeenCalledTimes(1));
    expect(cloud.put).toHaveBeenCalledTimes(2);
    expect(cloud.put.mock.calls[1]?.[0].invocationId).toBe(cloud.put.mock.calls[0]?.[0].invocationId);
    expect(cloud.put.mock.calls[1]?.[0].body).toEqual(cloud.put.mock.calls[0]?.[0].body);
  });

  it("recovers a prepared run after delivery response loss without minting a successor", async () => {
    cloud.deliver.mockRejectedValueOnce(new DOMException("timed out", "AbortError"));
    cloud.check.mockResolvedValueOnce({
      ...runFixture(),
      managedExecution: {
        ...runFixture().managedExecution,
        deliveryStatus: "prepared",
      },
    });
    const onOpenRun = vi.fn();
    render(
      <WorkflowDefinitionRunsPanel
        authCacheScope="user-1"
        definition={definition}
        managedRunsEnabled
        onOpenRun={onOpenRun}
      />,
    );
    fireEvent.change(screen.getByLabelText("ticket"), { target: { value: "PROL-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Run in Cloud" }));

    await screen.findByRole("button", { name: "Check or retry this run" });
    fireEvent.click(screen.getByRole("button", { name: "Check or retry this run" }));

    await waitFor(() => expect(onOpenRun).toHaveBeenCalledTimes(1));
    expect(cloud.put).toHaveBeenCalledTimes(1);
    expect(cloud.deliver).toHaveBeenCalledTimes(2);
    expect(cloud.deliver.mock.calls[1]?.[0].invocationId)
      .toBe(cloud.deliver.mock.calls[0]?.[0].invocationId);
  });

  it("fails closed until durable history resolves and while history is unavailable", () => {
    cloud.useHistory.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    });
    const props = {
      authCacheScope: "user-1",
      definition,
      managedRunsEnabled: true,
      onOpenRun: vi.fn(),
    };
    const { rerender } = render(<WorkflowDefinitionRunsPanel {...props} />);
    expect((screen.getByRole("button", { name: "Run in Cloud" }) as HTMLButtonElement).disabled)
      .toBe(true);

    cloud.useHistory.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    });
    rerender(<WorkflowDefinitionRunsPanel {...props} />);
    expect((screen.getByRole("button", { name: "Run in Cloud" }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect(screen.getByText(/history must load before starting/u)).toBeTruthy();

    cloud.useHistory.mockReturnValue({
      data: { pages: [{ items: [], nextCursor: null }] },
      isLoading: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    });
    cloud.useEligibility.mockReturnValue({
      data: { eligible: true, blockers: [] },
      isLoading: false,
      isError: true,
    });
    rerender(<WorkflowDefinitionRunsPanel {...props} />);
    expect((screen.getByRole("button", { name: "Run in Cloud" }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect(screen.getByText("Run eligibility could not be loaded.")).toBeTruthy();
  });

  it("reconciles argument drafts and eligibility to a saved definition revision", async () => {
    const props = {
      authCacheScope: "user-1",
      managedRunsEnabled: true,
      onOpenRun: vi.fn(),
    };
    const { rerender } = render(
      <WorkflowDefinitionRunsPanel {...props} definition={definition} />,
    );
    fireEvent.change(screen.getByLabelText("ticket"), { target: { value: "stale" } });

    const revised = {
      ...definition,
      revision: 4,
      inputs: [{ name: "summary", type: "string" as const, required: true }],
      stages: [{
        ...definition.stages[0]!,
        steps: [{ kind: "agent.prompt" as const, prompt: "Summarize {{inputs.summary}}", goal: null }],
      }],
    };
    rerender(<WorkflowDefinitionRunsPanel {...props} definition={revised} />);

    expect(screen.queryByLabelText("ticket")).toBeNull();
    fireEvent.change(screen.getByLabelText("summary"), { target: { value: "fresh" } });
    fireEvent.click(screen.getByRole("button", { name: "Run in Cloud" }));

    await waitFor(() => expect(cloud.put).toHaveBeenCalledTimes(1));
    expect(cloud.put).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({ expectedRevision: 4, arguments: { summary: "fresh" } }),
    }));
    expect(cloud.useEligibility).toHaveBeenLastCalledWith(definition.id, 4, "user-1");
  });

  it("aborts a launch operation at the exact bounded timeout", async () => {
    vi.useFakeTimers();
    let signal!: AbortSignal;
    cloud.put.mockImplementationOnce(({ signal: requestSignal }) => new Promise((_, reject) => {
      signal = requestSignal;
      requestSignal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    render(
      <WorkflowDefinitionRunsPanel
        authCacheScope="user-1"
        definition={definition}
        managedRunsEnabled
        onOpenRun={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("ticket"), { target: { value: "PROL-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Run in Cloud" }));

    await act(async () => vi.advanceTimersByTimeAsync(14_999));
    expect(signal.aborted).toBe(false);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(signal.aborted).toBe(true);
    expect(screen.getByText(/request timed out/u)).toBeTruthy();
  });

  it("fails closed when the route workflow does not match the returned run", () => {
    cloud.useRun.mockReturnValue({
      data: { ...runFixture(), workflowDefinitionId: "another-workflow" },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(
      <WorkflowRunsSurface
        authCacheScope="user-1"
        workflowDefinitionId={definition.id}
        runId="40000000-0000-4000-8000-000000000001"
        managedRunsEnabled
        onBack={vi.fn()}
        onOpenSession={vi.fn()}
      />,
    );
    expect(screen.getByText("Run not found")).toBeTruthy();
    expect(screen.queryByText("PROL-123")).toBeNull();
  });

  it("keeps a prepared run visible but fails closed when delivery capability is off", () => {
    cloud.useRun.mockReturnValue({
      data: runFixture({ deliveryStatus: "prepared" }),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    render(
      <WorkflowRunsSurface
        authCacheScope="user-1"
        workflowDefinitionId={definition.id}
        runId="40000000-0000-4000-8000-000000000001"
        managedRunsEnabled={false}
        onBack={vi.fn()}
        onOpenSession={vi.fn()}
      />,
    );
    expect((screen.getByRole("button", { name: "Start delivery" }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect(screen.getByText(/prepared run remains available/u)).toBeTruthy();
  });

  it("absorbs typed target loss, stops cancel, and retains an exact open target", async () => {
    const refetch = vi.fn();
    cloud.useRun.mockReturnValue({
      data: runFixture({ open: true }),
      isLoading: false,
      isError: false,
      error: null,
      refetch,
    });
    cloud.cancel.mockRejectedValueOnce(
      new ProliferateClientError("raw upstream detail", 409, "workflow_target_lost"),
    );
    render(
      <WorkflowRunsSurface
        authCacheScope="user-1"
        workflowDefinitionId={definition.id}
        runId="40000000-0000-4000-8000-000000000001"
        managedRunsEnabled
        onBack={vi.fn()}
        onOpenSession={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel run" }));

    await screen.findByText("Target lost");
    expect(screen.queryByRole("button", { name: "Cancel run" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open session" })).toBeTruthy();
    expect(screen.queryByText("raw upstream detail")).toBeNull();
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(cloud.useRun).toHaveBeenLastCalledWith(
      definition.id,
      "40000000-0000-4000-8000-000000000001",
      "user-1",
      false,
    );
  });

  it("retains cached detail on a transient refresh error", () => {
    cloud.useRun.mockReturnValue({
      data: runFixture(),
      isLoading: false,
      isError: true,
      error: new ProliferateClientError("raw", 503, "upstream_unavailable"),
      refetch: vi.fn(),
    });
    render(
      <WorkflowRunsSurface
        authCacheScope="user-1"
        workflowDefinitionId={definition.id}
        runId="40000000-0000-4000-8000-000000000001"
        managedRunsEnabled
        onBack={vi.fn()}
        onOpenSession={vi.fn()}
      />,
    );
    expect(screen.getByText("Run details")).toBeTruthy();
    expect(screen.getByText(/last known state is shown/u)).toBeTruthy();
    expect(screen.queryByText("raw")).toBeNull();
  });

  it("discards cached detail after an authoritative not-found response", () => {
    cloud.useRun.mockReturnValue({
      data: runFixture(),
      isLoading: false,
      isError: true,
      error: new ProliferateClientError("raw", 404, "workflow_invocation_not_found"),
      refetch: vi.fn(),
    });
    render(
      <WorkflowRunsSurface
        authCacheScope="user-1"
        workflowDefinitionId={definition.id}
        runId="40000000-0000-4000-8000-000000000001"
        managedRunsEnabled
        onBack={vi.fn()}
        onOpenSession={vi.fn()}
      />,
    );
    expect(screen.getByText("Run not found")).toBeTruthy();
    expect(screen.queryByText("Run details")).toBeNull();
    expect(screen.queryByText("PROL-123")).toBeNull();
    expect(screen.queryByText("raw")).toBeNull();
  });

  it.each([
    [503, "upstream_unavailable", "Run unavailable"],
    [404, "workflow_invocation_not_found", "Run not found"],
  ])("distinguishes initial HTTP %s detail failure", (status, code, title) => {
    cloud.useRun.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ProliferateClientError("raw detail", status, code),
      refetch: vi.fn(),
    });
    render(
      <WorkflowRunsSurface
        authCacheScope="user-1"
        workflowDefinitionId={definition.id}
        runId="40000000-0000-4000-8000-000000000001"
        managedRunsEnabled
        onBack={vi.fn()}
        onOpenSession={vi.fn()}
      />,
    );
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.queryByText("raw detail")).toBeNull();
  });

  it("appends cursor pages in server order and removes replayed boundary rows", () => {
    const fetchNextPage = vi.fn();
    cloud.useHistory.mockReturnValue({
      data: {
        pages: [
          { items: [historyItem("run-3"), historyItem("run-2")], nextCursor: "cursor-2" },
          { items: [historyItem("run-2"), historyItem("run-1")], nextCursor: null },
        ],
      },
      isLoading: false,
      isError: false,
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage,
      refetch: vi.fn(),
    });
    render(
      <WorkflowDefinitionRunsPanel
        authCacheScope="user-1"
        definition={definition}
        managedRunsEnabled
        onOpenRun={vi.fn()}
      />,
    );

    expect(screen.getAllByText(/Revision 3/u)).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });
});

function runFixture(overrides: { deliveryStatus?: string; open?: boolean } = {}) {
  return {
    id: "40000000-0000-4000-8000-000000000001",
    schemaVersion: 1,
    workflowDefinitionId: definition.id,
    definitionRevision: 3,
    title: "Triage",
    description: "",
    definition: { inputs: definition.inputs, stages: [] },
    arguments: { ticket: "PROL-123" },
    placement: { kind: "scratch" },
    target: { kind: "managedCloud" },
    createdAt: "2026-07-16T00:00:00Z",
    managedExecution: {
      deliveryStatus: overrides.deliveryStatus ?? "queued",
      deliveryCheckpoint: "target_plan_frozen",
      desiredState: "active",
      execution: null,
      freshness: { status: "pending", latestObservedAt: null },
      correlations: {
        cloudWorkspaceId: overrides.open ? "cloud-1" : null,
        anyharnessWorkspaceId: overrides.open ? "runtime-1" : null,
        sessionId: overrides.open ? "session-1" : null,
        promptId: null,
        turnId: null,
      },
      openTarget: overrides.open ? {
        cloudWorkspaceId: "cloud-1",
        anyharnessWorkspaceId: "runtime-1",
        sessionId: "session-1",
      } : null,
      deliveryErrorCode: null,
      observationErrorCode: null,
      acceptedAt: null,
      updatedAt: "2026-07-16T00:00:00Z",
    },
  };
}

function historyItem(id: string) {
  return {
    id,
    workflowDefinitionId: definition.id,
    definitionRevision: 3,
    title: "Triage",
    placementKind: "scratch",
    targetKind: "managedCloud",
    deliveryStatus: "queued",
    desiredState: "active",
    executionStatus: null,
    freshness: "pending",
    latestObservedAt: null,
    cloudWorkspaceId: null,
    sessionId: null,
    createdAt: "2026-07-16T00:00:00Z",
    updatedAt: "2026-07-16T00:00:00Z",
  };
}
