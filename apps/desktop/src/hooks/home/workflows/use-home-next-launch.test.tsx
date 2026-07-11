// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderableOutboxEntriesForTranscript } from "@proliferate/product-domain/sessions/intents/session-intent-selectors";
import {
  buildPendingWorkspaceUiKey,
  buildSubmittingPendingWorkspaceEntry,
} from "@/lib/domain/workspaces/creation/pending-entry";
import {
  createEmptySessionRecord,
  getSessionRecord,
  putSessionRecord,
} from "@/stores/sessions/session-records";
import {
  getPromptOutboxEntriesForSession,
  useSessionIntentStore,
} from "@/stores/sessions/session-intent-store";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";
import { useChatLaunchIntentStore } from "@/stores/chat/chat-launch-intent-store";
import { useDeferredHomeLaunchStore } from "@/stores/home/deferred-home-launch-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { useHomeNextLaunch } from "./use-home-next-launch";

const mocks = vi.hoisted(() => ({
  createCloudWorkspaceAndEnterWithResult: vi.fn(),
  createEmptySessionWithResolvedConfig: vi.fn(),
  createLocalWorkspaceAndEnterWithResult: vi.fn(),
  createSessionWithResolvedConfig: vi.fn(),
  createThreadFromSelection: vi.fn(),
  createWorktreeAndEnterWithResult: vi.fn(),
  navigate: vi.fn(),
  selectWorkspace: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("@/hooks/cloud/workflows/use-create-cloud-workspace", () => ({
  useCreateCloudWorkspace: () => ({
    createCloudWorkspaceAndEnterWithResult: mocks.createCloudWorkspaceAndEnterWithResult,
  }),
}));

vi.mock("@/hooks/cowork/workflows/use-cowork-thread-workflow", () => ({
  useCoworkThreadWorkflow: () => ({
    createThreadFromSelection: mocks.createThreadFromSelection,
  }),
}));

vi.mock("@/hooks/workspaces/workflows/use-workspace-entry-actions", () => ({
  useWorkspaceEntryActions: () => ({
    createLocalWorkspaceAndEnterWithResult: mocks.createLocalWorkspaceAndEnterWithResult,
    createWorktreeAndEnterWithResult: mocks.createWorktreeAndEnterWithResult,
  }),
}));

vi.mock("@/hooks/workspaces/workflows/selection/use-workspace-selection", () => ({
  useWorkspaceSelection: () => ({
    selectWorkspace: mocks.selectWorkspace,
  }),
}));

vi.mock("@/hooks/sessions/workflows/use-session-creation-actions", () => ({
  useSessionCreationActions: () => ({
    createEmptySessionWithResolvedConfig: mocks.createEmptySessionWithResolvedConfig,
    createSessionWithResolvedConfig: mocks.createSessionWithResolvedConfig,
  }),
}));

vi.mock("@/hooks/workspaces/derived/use-workspace-runtime-block", () => ({
  useWorkspaceRuntimeBlock: () => ({
    getWorkspaceRuntimeBlockReason: () => null,
  }),
}));

vi.mock("@/hooks/sessions/workflows/use-session-interaction-resolution-actions", () => ({
  useSessionInteractionResolutionActions: () => ({
    resolvePermission: vi.fn(),
    resolveMcpElicitation: vi.fn(),
    resolveUserInput: vi.fn(),
    revealMcpElicitationUrl: vi.fn(),
  }),
}));

describe("useHomeNextLaunch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionDirectoryStore.getState().clearEntries();
    useSessionTranscriptStore.getState().clearEntries();
    useSessionIntentStore.getState().clear();
    useSessionSelectionStore.getState().clearSelection();
    useChatLaunchIntentStore.setState({ activeIntent: null });
    useDeferredHomeLaunchStore.setState({ launches: {} });
    useToastStore.setState({ toasts: [] });
  });

  it("projects one destination prompt for a Home worktree launch", async () => {
    const sessionId = "client-session:codex:home-worktree";
    const pendingEntry = buildSubmittingPendingWorkspaceEntry({
      attemptId: "home-worktree-attempt",
      selectedWorkspaceId: null,
      source: "worktree-created",
      displayName: "home-worktree",
      repoLabel: "repo",
      baseBranchName: "main",
      request: {
        kind: "worktree",
        input: {
          repoRootId: "repo-root-1",
          sourceWorkspaceId: null,
          baseBranch: "main",
          defaultBranch: "main",
        },
      },
    });
    const pendingWorkspaceId = buildPendingWorkspaceUiKey(pendingEntry);

    mocks.createWorktreeAndEnterWithResult.mockImplementation(async () => {
      putSessionRecord(createEmptySessionRecord(sessionId, "codex", {
        workspaceId: pendingWorkspaceId,
        materializedSessionId: null,
        modelId: "gpt-5.4",
      }));
      useSessionSelectionStore.getState().enterPendingWorkspaceShell(pendingEntry, {
        initialActiveSessionId: sessionId,
      });
      return {
        workspaceId: "workspace-real",
        projectedSessionId: sessionId,
      };
    });

    const { result } = renderHook(() => useHomeNextLaunch());
    let succeeded = false;
    await act(async () => {
      succeeded = await result.current.launch({
        text: "build the projected destination",
        modelSelection: { kind: "codex", modelId: "gpt-5.4" },
        modeId: null,
        launchControlValues: {},
        target: {
          kind: "worktree",
          repoRootId: "repo-root-1",
          sourceWorkspaceId: null,
          baseBranch: "main",
          defaultBranch: "main",
        },
      });
    });

    const record = getSessionRecord(sessionId);
    const promptIntents = getPromptOutboxEntriesForSession(sessionId);
    const destinationPromptRows = record
      ? renderableOutboxEntriesForTranscript(promptIntents, record.transcript)
      : [];

    expect(succeeded).toBe(true);
    expect(promptIntents).toHaveLength(1);
    expect(destinationPromptRows).toHaveLength(1);
    expect(destinationPromptRows[0]?.text).toBe("build the projected destination");
    expect(mocks.createSessionWithResolvedConfig).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
  });
});
