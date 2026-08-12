// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentsPaneLifecycleActions } from "#product/hooks/agents/workflows/use-agents-pane-lifecycle-actions";

const mocks = vi.hoisted(() => ({
  closeMutate: vi.fn(),
  openMutate: vi.fn(),
  promoteMutate: vi.fn(),
  clearSession: vi.fn(),
  closeSessionSlotStream: vi.fn(),
}));

vi.mock("@anyharness/sdk", () => {
  class AnyHarnessError extends Error {
    problem: { title: string; status: number; code?: string };
    constructor(problem: { title: string; status: number; code?: string }) {
      super(problem.title);
      this.name = "AnyHarnessError";
      this.problem = problem;
    }
  }
  return { AnyHarnessError };
});

vi.mock("@anyharness/sdk-react", () => ({
  useCloseSubagentMutation: () => ({ mutateAsync: mocks.closeMutate, isPending: false }),
  useOpenSubagentMutation: () => ({ mutateAsync: mocks.openMutate, isPending: false }),
  usePromoteSubagentMutation: () => ({ mutateAsync: mocks.promoteMutate, isPending: false }),
}));

vi.mock("#product/stores/sessions/session-intent-store", () => ({
  useSessionIntentStore: {
    getState: () => ({ clearSession: mocks.clearSession }),
  },
}));

vi.mock("#product/hooks/sessions/lifecycle/session-stream-slot-connection", () => ({
  closeSessionSlotStream: mocks.closeSessionSlotStream,
}));

const TARGET = {
  parentSessionId: "sess-parent",
  childSessionId: "sess-child",
  clientSessionId: "client-child",
};

function agentResponse(presentation: "running" | "available" | "closed") {
  return {
    agent: {
      status: { execution: "running", hasLiveActor: true, presentation },
      workspace: { runtimeId: "rt-1", workspaceId: "ws-1" },
      configuration: { agentKind: "claude" },
    },
    relationship: null,
  };
}

async function makeAnyHarnessError(status: number, code?: string) {
  const { AnyHarnessError } = await import("@anyharness/sdk");
  return new (AnyHarnessError as unknown as new (problem: {
    title: string;
    status: number;
    code?: string;
  }) => Error)({
    title: "Request failed",
    status,
    code,
  });
}

describe("useAgentsPaneLifecycleActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  it("close success purges local intents for the mapped client session and disconnects the pane stream", async () => {
    mocks.closeMutate.mockResolvedValue(agentResponse("closed"));
    const { result } = renderHook(() => useAgentsPaneLifecycleActions({ workspaceId: "ws-1" }));

    const outcome = await result.current.closeChild(TARGET);

    expect(mocks.closeMutate).toHaveBeenCalledWith({
      parentSessionId: "sess-parent",
      childSessionId: "sess-child",
    });
    expect(outcome.ok).toBe(true);
    expect(mocks.clearSession).toHaveBeenCalledWith("client-child");
    expect(mocks.closeSessionSlotStream).toHaveBeenCalledWith("client-child");
  });

  it("close failure never purges intents or touches the stream", async () => {
    mocks.closeMutate.mockRejectedValue(await makeAnyHarnessError(500));
    const { result } = renderHook(() => useAgentsPaneLifecycleActions({ workspaceId: "ws-1" }));

    const outcome = await result.current.closeChild(TARGET);

    expect(outcome.ok).toBe(false);
    expect(mocks.clearSession).not.toHaveBeenCalled();
    expect(mocks.closeSessionSlotStream).not.toHaveBeenCalled();
  });

  it("open returns the response presentation truth (running or available)", async () => {
    mocks.openMutate.mockResolvedValue(agentResponse("running"));
    const { result } = renderHook(() => useAgentsPaneLifecycleActions({ workspaceId: "ws-1" }));

    const outcome = await result.current.openChild(TARGET);

    expect(outcome).toMatchObject({ ok: true, presentation: "running" });
  });

  it("promote 404 is a typed failure, never success", async () => {
    mocks.promoteMutate.mockRejectedValue(await makeAnyHarnessError(404));
    const { result } = renderHook(() => useAgentsPaneLifecycleActions({ workspaceId: "ws-1" }));

    const outcome = await result.current.promoteChild(TARGET);

    expect(outcome).toMatchObject({
      ok: false,
      action: "promote",
      kind: "not_found",
      status: 404,
      parentSessionId: "sess-parent",
      childSessionId: "sess-child",
      clientSessionId: "client-child",
    });
  });

  it("promote 409 is the closed race, surfaced as an error for refetch", async () => {
    mocks.promoteMutate.mockRejectedValue(
      await makeAnyHarnessError(409, "SUBAGENT_OPEN_REQUIRED"),
    );
    const { result } = renderHook(() => useAgentsPaneLifecycleActions({ workspaceId: "ws-1" }));

    const outcome = await result.current.promoteChild(TARGET);

    expect(outcome).toMatchObject({ ok: false, kind: "closed_race", status: 409 });
  });

  it("does not misclassify a workflow-control 409 as a Closed race", async () => {
    mocks.promoteMutate.mockRejectedValue(
      await makeAnyHarnessError(409, "SESSION_CONTROLLED_BY_WORKFLOW"),
    );
    const { result } = renderHook(() =>
      useAgentsPaneLifecycleActions({ workspaceId: "ws-1" })
    );

    const outcome = await result.current.promoteChild(TARGET);

    expect(outcome).toMatchObject({
      ok: false,
      action: "promote",
      kind: "unknown",
      code: "SESSION_CONTROLLED_BY_WORKFLOW",
    });
  });

  it("promote success carries the mapped ids and workspace for tab integration", async () => {
    mocks.promoteMutate.mockResolvedValue(agentResponse("available"));
    const { result } = renderHook(() => useAgentsPaneLifecycleActions({ workspaceId: "ws-1" }));

    const outcome = await result.current.promoteChild(TARGET);

    expect(outcome).toMatchObject({
      ok: true,
      workspaceId: "ws-1",
      childSessionId: "sess-child",
      clientSessionId: "client-child",
    });
  });
});
