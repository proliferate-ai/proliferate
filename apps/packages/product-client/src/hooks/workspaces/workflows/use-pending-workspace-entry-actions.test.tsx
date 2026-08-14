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
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("#product/stores/editor/workspace-editor-state", () => ({
  resetWorkspaceEditorState: vi.fn(),
}));

vi.mock("#product/hooks/cloud/workflows/use-create-cloud-workspace", () => ({
  useCreateCloudWorkspace: () => ({ retryCloudWorkspaceAndEnter: vi.fn() }),
}));

vi.mock("#product/hooks/workspaces/workflows/use-workspace-entry-actions", () => ({
  useWorkspaceEntryActions: () => ({
    createLocalWorkspaceAndEnter: vi.fn(),
    createWorktreeAndEnter: vi.fn(),
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
});
