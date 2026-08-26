// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatLaunchIntent } from "#product/lib/domain/chat/launch/launch-intent";
import {
  buildPendingWorkspaceUiKey,
  buildSubmittingPendingWorkspaceEntry,
  type PendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry";
import {
  EMPTY_PENDING_WORKSPACE_REGISTRY,
  upsertPendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry-registry";
import {
  usePendingWorkspaceEntryActions,
} from "#product/hooks/workspaces/workflows/use-pending-workspace-entry-actions";
import { useChatLaunchIntentStore } from "#product/stores/chat/chat-launch-intent-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  selectWorkspace: vi.fn(),
  clearWorkspaceRuntimeState: vi.fn(),
  showToast: vi.fn(),
  createLocalWorkspaceAndEnter: vi.fn(),
  createWorktreeAndEnter: vi.fn(),
  cloudComputeEnabled: true,
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("#product/stores/editor/workspace-editor-state", () => ({
  resetWorkspaceEditorState: vi.fn(),
}));

vi.mock("#product/hooks/capabilities/derived/use-app-capabilities", () => ({
  useAppCapabilities: () => ({ cloudComputeEnabled: mocks.cloudComputeEnabled }),
}));

vi.mock("#product/hooks/workspaces/workflows/use-workspace-entry-actions", () => ({
  useWorkspaceEntryActions: () => ({
    createLocalWorkspaceAndEnter: mocks.createLocalWorkspaceAndEnter,
    createWorktreeAndEnter: mocks.createWorktreeAndEnter,
  }),
}));

vi.mock("#product/hooks/workspaces/workflows/selection/use-workspace-selection", () => ({
  useWorkspaceSelection: () => ({
    selectWorkspace: mocks.selectWorkspace,
    clearWorkspaceRuntimeState: mocks.clearWorkspaceRuntimeState,
  }),
}));

vi.mock("#product/hooks/workspaces/cache/use-workspaces", () => ({
  useWorkspaces: () => ({ data: { cloudWorkspaces: [] } }),
}));

vi.mock("#product/hooks/workspaces/workflows/use-pending-workspace-session-materialization", () => ({
  usePendingWorkspaceSessionMaterialization: () => vi.fn(),
}));

vi.mock("#product/stores/toast/toast-store", () => ({
  useToastStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ show: mocks.showToast }),
}));

function entry(attemptId: string): PendingWorkspaceEntry {
  return buildSubmittingPendingWorkspaceEntry({
    attemptId,
    selectedWorkspaceId: null,
    source: "local-created",
    displayName: attemptId,
    request: { kind: "local", sourceRoot: "/tmp/landing" },
  });
}

function intent(id: string, attemptId: string): ChatLaunchIntent {
  return {
    id,
    promptId: `prompt-${id}`,
    text: id,
    contentParts: [{ type: "text", text: id }],
    targetKind: "local",
    retryInput: {
      text: id,
      modelSelection: { kind: "codex", modelId: "gpt-5.4" },
      modeId: null,
      target: { kind: "cowork" },
    },
    materializedWorkspaceId: null,
    materializedSessionId: null,
    attemptId,
    targetWorkspaceId: null,
    createdAt: 100,
    sendAttemptedAt: null,
    failure: null,
  };
}

describe("usePendingWorkspaceEntryActions", () => {
  const dismissed = entry("attempt-dismissed");
  const other = entry("attempt-other");

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cloudComputeEnabled = true;
    useSessionSelectionStore.getState().clearSelection();
    useSessionSelectionStore.setState({
      pendingWorkspaces: [dismissed, other]
        .reduce(upsertPendingWorkspaceEntry, EMPTY_PENDING_WORKSPACE_REGISTRY),
      selectedLogicalWorkspaceId: buildPendingWorkspaceUiKey(dismissed),
    });
    useChatLaunchIntentStore.setState({ intentsById: {}, intentOrder: [] });
    useChatLaunchIntentStore.getState().begin(intent("launch-dismissed", dismissed.attemptId));
    useChatLaunchIntentStore.getState().begin(intent("launch-other", other.attemptId));
  });

  afterEach(cleanup);

  it("dismisses one attempt and its launch intent, leaving the other running", async () => {
    const { result } = renderHook(() => usePendingWorkspaceEntryActions());

    await act(async () => {
      await result.current.handleBack(dismissed);
    });

    expect(useSessionSelectionStore.getState().pendingWorkspaces.attemptOrder)
      .toEqual([other.attemptId]);
    expect(useChatLaunchIntentStore.getState().intentOrder).toEqual(["launch-other"]);
  });

  // PR #1870 review finding 2: retry mints a fresh attempt, so leaving the
  // failed one behind left a permanent "Couldn't create workspace" row beside
  // the retry that succeeded — with plural rows, nothing ever collected it.
  it("replaces the retried attempt instead of leaving it in the sidebar", async () => {
    const failed = { ...dismissed, stage: "failed" as const, errorMessage: "boom" };
    // The real create registers its replacement entry synchronously, before the
    // first await — which is what makes ending the failed attempt afterwards a
    // swap rather than an empty sidebar.
    const replacement = entry("attempt-replacement");
    mocks.createLocalWorkspaceAndEnter.mockImplementation(async () => {
      useSessionSelectionStore.setState((state) => ({
        pendingWorkspaces: upsertPendingWorkspaceEntry(state.pendingWorkspaces, replacement),
      }));
    });

    const { result } = renderHook(() => usePendingWorkspaceEntryActions());

    await act(async () => {
      await result.current.handleRetry(failed);
    });

    expect(mocks.createLocalWorkspaceAndEnter).toHaveBeenCalledWith("/tmp/landing");
    expect(useSessionSelectionStore.getState().pendingWorkspaces.attemptOrder)
      .toEqual([other.attemptId, replacement.attemptId]);
    // The intent that owned the retried attempt goes with it, so no stale
    // "Couldn't start work" pane outlives the replacement.
    expect(useChatLaunchIntentStore.getState().intentOrder).toEqual(["launch-other"]);
  });

  // The cloud create flow is deleted with the sandbox stack: a stale cloud
  // attempt's Retry always refuses with the shared unavailability toast and
  // ends the attempt, same as the cowork "not wired up" case.
  it("refuses the cloud retry and surfaces the unavailable toast", async () => {
    const cloudEntry: PendingWorkspaceEntry = {
      ...dismissed,
      stage: "failed",
      errorMessage: "boom",
      request: {
        kind: "cloud",
        input: {
          gitOwner: "proliferate-ai",
          gitRepoName: "proliferate",
          baseBranch: "main",
          branchName: "pablo/retry",
          generatedName: false,
        },
      },
    };

    const { result } = renderHook(() => usePendingWorkspaceEntryActions());

    await act(async () => {
      await result.current.handleRetry(cloudEntry);
    });

    expect(mocks.showToast).toHaveBeenCalledWith("Cloud workspaces are no longer available.");
    // The dead attempt still gets ended, same as the cowork "not wired up" case.
    expect(useSessionSelectionStore.getState().pendingWorkspaces.attemptOrder)
      .toEqual([other.attemptId]);
  });
});
