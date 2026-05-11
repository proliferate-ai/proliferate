import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPendingWorkspaceUiKey,
  buildSubmittingPendingWorkspaceEntry,
} from "@/lib/domain/workspaces/creation/pending-entry";
import {
  createEmptySessionRecord,
  getSessionRecord,
  putSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";
import {
  usePendingWorkspaceSessionMaterialization,
} from "@/hooks/workspaces/workflows/use-pending-workspace-session-materialization";

const mocks = vi.hoisted(() => ({
  createEmptySessionWithResolvedConfig: vi.fn(async (options: { clientSessionId: string }) =>
    options.clientSessionId
  ),
}));

vi.mock("react", () => ({
  useCallback: <T extends (...args: never[]) => unknown>(callback: T) => callback,
}));

vi.mock("@/hooks/sessions/use-session-creation-actions", () => ({
  useSessionCreationActions: () => ({
    createEmptySessionWithResolvedConfig: mocks.createEmptySessionWithResolvedConfig,
  }),
}));

vi.mock("@/lib/infra/measurement/debug-latency", () => ({
  logLatency: vi.fn(),
}));

describe("usePendingWorkspaceSessionMaterialization", () => {
  beforeEach(() => {
    mocks.createEmptySessionWithResolvedConfig.mockClear();
    useSessionDirectoryStore.getState().clearEntries();
    useSessionTranscriptStore.getState().clearEntries();
  });

  it("remaps projected pending-workspace sessions and starts real runtime sessions", async () => {
    const entry = buildSubmittingPendingWorkspaceEntry({
      attemptId: "attempt-1",
      selectedWorkspaceId: null,
      source: "cloud-created",
      displayName: "feature-branch",
      request: { kind: "select-existing", workspaceId: "cloud-workspace-1" },
    });
    const pendingWorkspaceUiKey = buildPendingWorkspaceUiKey(entry);
    putSessionRecord(createEmptySessionRecord("client-session:codex:1", "codex", {
      workspaceId: pendingWorkspaceUiKey,
      materializedSessionId: null,
      modelId: "gpt-5.5",
      modeId: "full-access",
    }));

    const materializePendingWorkspaceSessions = usePendingWorkspaceSessionMaterialization();
    const materializationResult = materializePendingWorkspaceSessions(entry, "workspace-real", {
      eventPrefix: "test",
    });
    await Promise.resolve();

    expect(materializationResult).toEqual({
      pendingWorkspaceUiKey,
      projectedSessionCount: 1,
      projectedSessionIds: ["client-session:codex:1"],
    });
    expect(getSessionRecord("client-session:codex:1")?.workspaceId).toBe("workspace-real");
    expect(mocks.createEmptySessionWithResolvedConfig).toHaveBeenCalledWith({
      clientSessionId: "client-session:codex:1",
      workspaceId: "workspace-real",
      agentKind: "codex",
      modelId: "gpt-5.5",
      modeId: "full-access",
      reuseInFlightEmptySession: false,
    });
  });
});
