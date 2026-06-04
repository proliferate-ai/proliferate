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
  promptAttachmentSnapshotsToBlocks: vi.fn(),
  rehydrateSessionSlotFromHistory: vi.fn(),
  sendCloudPromptCommand: vi.fn(),
  waitForSessionMaterialization: vi.fn(),
}));

vi.mock("@/lib/access/browser/prompt-attachment-blocks", () => ({
  promptAttachmentSnapshotsToBlocks: mocks.promptAttachmentSnapshotsToBlocks,
}));

vi.mock("@/lib/access/anyharness/session-runtime", () => ({
  getSessionClientAndWorkspace: mocks.getSessionClientAndWorkspace,
}));

vi.mock("@/lib/access/cloud/session-commands", () => ({
  sendCloudPromptCommand: mocks.sendCloudPromptCommand,
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
}));

describe("dispatchPromptIntent", () => {
  beforeEach(() => {
    useSessionIntentStore.getState().clear();
    vi.clearAllMocks();
    mocks.getLatencyFlowRequestHeaders.mockReturnValue(null);
    mocks.getSessionClientAndWorkspace.mockResolvedValue({
      target: { location: "local" },
      workspaceId: "workspace-1",
      materializedSessionId: "session-1",
    });
    mocks.getSessionRecord.mockReturnValue({ lastPromptAt: "2026-06-04T09:00:00Z" });
    mocks.waitForSessionMaterialization.mockResolvedValue("session-1");
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
});

function createDeps(): PromptIntentDispatchDeps {
  return {
    applySessionSummary: vi.fn(),
    maybeGenerateSessionTitle: vi.fn(),
    promptSessionMutation: {
      mutateAsync: mocks.mutateAsync,
    } as unknown as PromptIntentDispatchDeps["promptSessionMutation"],
    rehydrateSessionSlotFromHistory: mocks.rehydrateSessionSlotFromHistory,
    upsertWorkspaceSessionRecord: vi.fn(),
  };
}
