import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dispatchPromptIntent,
  type PromptIntentDispatchDeps,
} from "@/hooks/sessions/lifecycle/session-intent-prompt-dispatch";
import { useSessionIntentStore } from "@/stores/sessions/session-intent-store";

const mocks = vi.hoisted(() => ({
  failLatencyFlow: vi.fn(),
  finishLatencyFlow: vi.fn(),
  getLatencyFlowRequestHeaders: vi.fn(),
  getSessionClientAndWorkspace: vi.fn(),
  getSessionRecord: vi.fn(),
  logLatency: vi.fn(),
  mutateAsync: vi.fn(),
  patchSessionRecord: vi.fn(),
  prepareLocalRuntimeConfigForTarget: vi.fn(),
  promptAttachmentSnapshotsToBlocks: vi.fn(),
  rehydrateSessionSlotFromHistory: vi.fn(),
  waitForSessionMaterialization: vi.fn(),
}));

vi.mock("@/lib/access/browser/prompt-attachment-blocks", () => ({
  promptAttachmentSnapshotsToBlocks: mocks.promptAttachmentSnapshotsToBlocks,
}));

vi.mock("@/lib/access/anyharness/session-runtime", () => ({
  getSessionClientAndWorkspace: mocks.getSessionClientAndWorkspace,
}));

vi.mock("@/lib/access/anyharness/session-runtime-config", () => ({
  prepareLocalRuntimeConfigForTarget: mocks.prepareLocalRuntimeConfigForTarget,
}));

vi.mock("@/lib/infra/measurement/debug-latency", () => ({
  logLatency: mocks.logLatency,
}));

vi.mock("@/lib/infra/measurement/latency-flow", () => ({
  failLatencyFlow: mocks.failLatencyFlow,
  finishLatencyFlow: mocks.finishLatencyFlow,
  getLatencyFlowRequestHeaders: mocks.getLatencyFlowRequestHeaders,
}));

vi.mock("@/lib/workflows/sessions/session-materialization", () => ({
  waitForSessionMaterialization: mocks.waitForSessionMaterialization,
}));

vi.mock("@/hooks/sessions/workflows/session-materialization-deps", () => ({
  sessionMaterializationDeps: {},
}));

vi.mock("@/stores/sessions/session-records", () => ({
  getSessionRecord: mocks.getSessionRecord,
  patchSessionRecord: mocks.patchSessionRecord,
}));

describe("dispatchPromptIntent", () => {
  beforeEach(() => {
    useSessionIntentStore.getState().clear();
    vi.clearAllMocks();
    mocks.getLatencyFlowRequestHeaders.mockReturnValue(null);
    mocks.getSessionClientAndWorkspace.mockResolvedValue({
      connection: {
        runtimeUrl: "http://runtime.local",
        anyharnessWorkspaceId: "workspace-1",
      },
      target: { location: "local" },
      workspaceId: "workspace-1",
      materializedSessionId: "session-1",
    });
    mocks.getSessionRecord.mockReturnValue({ lastPromptAt: "2026-06-04T09:00:00Z" });
    mocks.prepareLocalRuntimeConfigForTarget.mockResolvedValue(null);
    mocks.waitForSessionMaterialization.mockResolvedValue("session-1");
  });

  it("marks the prompt attempt on the session record before dispatching the request", async () => {
    const entry = useSessionIntentStore.getState().enqueuePrompt({
      clientPromptId: "prompt-1",
      clientSessionId: "client-session-1",
      workspaceId: "workspace-1",
      text: "Build please",
      blocks: [{ type: "text", text: "Build please" }],
    });
    mocks.mutateAsync.mockResolvedValue({
      session: { id: "session-1" },
      status: "queued",
      queuedSeq: 4,
    });

    await dispatchPromptIntent(entry, createDeps());

    expect(mocks.patchSessionRecord).toHaveBeenCalledWith(
      "client-session-1",
      { hasAttemptedPrompt: true },
    );
    expect(mocks.patchSessionRecord.mock.invocationCallOrder[0]!)
      .toBeLessThan(mocks.mutateAsync.mock.invocationCallOrder[0]!);
  });

  it("does not overwrite a reconciled prompt when a late dispatch failure arrives", async () => {
    const entry = useSessionIntentStore.getState().enqueuePrompt({
      clientPromptId: "prompt-1",
      clientSessionId: "client-session-1",
      workspaceId: "workspace-1",
      text: "Build please",
      blocks: [{ type: "text", text: "Build please" }],
    });
    mocks.mutateAsync.mockImplementation(async () => {
      useSessionIntentStore.getState().patchIntent("prompt-1", {
        status: "reconciled",
        deliveryState: "echoed_tombstone",
        echoedAt: "2026-06-04T09:11:55Z",
        errorMessage: null,
      });
      throw new Error("Network dropped after the runtime accepted the prompt.");
    });

    await dispatchPromptIntent(entry, createDeps());

    expect(useSessionIntentStore.getState().entriesById["prompt-1"]).toMatchObject({
      status: "reconciled",
      deliveryState: "echoed_tombstone",
      errorMessage: null,
    });
    expect(mocks.rehydrateSessionSlotFromHistory).not.toHaveBeenCalled();
  });

  it("requests session title and workspace name on the first prompt", async () => {
    mocks.getSessionRecord.mockReturnValue({ lastPromptAt: null });
    const entry = useSessionIntentStore.getState().enqueuePrompt({
      clientPromptId: "prompt-1",
      clientSessionId: "client-session-1",
      workspaceId: "workspace-1",
      text: "Build please",
      blocks: [{ type: "text", text: "Build please" }],
    });
    mocks.mutateAsync.mockResolvedValue({
      session: { id: "session-1" },
      status: "queued",
      queuedSeq: 4,
    });
    const deps = createDeps();

    await dispatchPromptIntent(entry, deps);

    expect(deps.maybeGenerateSessionTitle).toHaveBeenCalledWith({
      sessionId: "client-session-1",
      firstUserMessage: "Build please",
    });
    expect(deps.maybeGenerateWorkspaceName).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      clientSessionId: "client-session-1",
      firstUserMessage: "Build please",
    });
  });

  it("does not request a workspace name on a subsequent prompt", async () => {
    mocks.getSessionRecord.mockReturnValue({ lastPromptAt: "2026-06-04T09:00:00Z" });
    const entry = useSessionIntentStore.getState().enqueuePrompt({
      clientPromptId: "prompt-1",
      clientSessionId: "client-session-1",
      workspaceId: "workspace-1",
      text: "Keep going",
      blocks: [{ type: "text", text: "Keep going" }],
    });
    mocks.mutateAsync.mockResolvedValue({
      session: { id: "session-1" },
      status: "queued",
      queuedSeq: 4,
    });
    const deps = createDeps();

    await dispatchPromptIntent(entry, deps);

    expect(deps.maybeGenerateSessionTitle).not.toHaveBeenCalled();
    expect(deps.maybeGenerateWorkspaceName).not.toHaveBeenCalled();
  });

  it("reapplies local runtime config before dispatching a local prompt", async () => {
    const entry = useSessionIntentStore.getState().enqueuePrompt({
      clientPromptId: "prompt-1",
      clientSessionId: "client-session-1",
      workspaceId: "workspace-1",
      text: "Build please",
      blocks: [{ type: "text", text: "Build please" }],
    });
    mocks.mutateAsync.mockResolvedValue({
      session: { id: "session-1" },
      status: "queued",
      queuedSeq: 1,
    });

    await dispatchPromptIntent(entry, createDeps());

    expect(mocks.prepareLocalRuntimeConfigForTarget).toHaveBeenCalledWith(
      { location: "local" },
      {
        runtimeUrl: "http://runtime.local",
        anyharnessWorkspaceId: "workspace-1",
      },
      undefined,
    );
    expect(mocks.prepareLocalRuntimeConfigForTarget.mock.invocationCallOrder[0]!)
      .toBeLessThan(mocks.mutateAsync.mock.invocationCallOrder[0]!);
  });

  it("dispatches cloud sandbox gateway prompts through AnyHarness", async () => {
    mocks.getSessionClientAndWorkspace.mockResolvedValue({
      connection: {
        runtimeUrl: "http://api.local/v1/gateway/cloud-sandbox/anyharness",
        authToken: "product-token",
        anyharnessWorkspaceId: "sandbox-workspace-1",
      },
      target: {
        location: "cloud",
        runtimeAccessKind: "proliferate-gateway",
        baseUrl: "http://api.local/v1/gateway/cloud-sandbox/anyharness",
        authToken: "product-token",
        anyharnessWorkspaceId: "sandbox-workspace-1",
        runtimeGeneration: 1,
        cloudWorkspaceId: "cloud-workspace-1",
      },
      workspaceId: "cloud:cloud-workspace-1",
      materializedSessionId: "session-1",
    });
    const entry = useSessionIntentStore.getState().enqueuePrompt({
      clientPromptId: "prompt-1",
      clientSessionId: "client-session-1",
      workspaceId: "cloud:cloud-workspace-1",
      text: "Build please",
      blocks: [{ type: "text", text: "Build please" }],
    });
    mocks.mutateAsync.mockResolvedValue({
      session: { id: "session-1" },
      status: "queued",
      queuedSeq: 1,
    });

    await dispatchPromptIntent(entry, createDeps());

    expect(mocks.mutateAsync).toHaveBeenCalledWith({
      workspaceId: "cloud:cloud-workspace-1",
      sessionId: "session-1",
      request: {
        promptId: "prompt-1",
        blocks: [{ type: "text", text: "Build please" }],
      },
      requestOptions: undefined,
    });
  });
});

function createDeps(): PromptIntentDispatchDeps {
  return {
    applySessionSummary: vi.fn(),
    maybeGenerateSessionTitle: vi.fn(),
    maybeGenerateWorkspaceName: vi.fn(),
    promptSessionMutation: {
      mutateAsync: mocks.mutateAsync,
    } as unknown as PromptIntentDispatchDeps["promptSessionMutation"],
    rehydrateSessionSlotFromHistory: mocks.rehydrateSessionSlotFromHistory,
    upsertWorkspaceSessionRecord: vi.fn(),
  };
}
