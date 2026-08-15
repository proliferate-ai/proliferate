import { beforeEach, describe, expect, it, vi } from "vitest";
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
  notifyUnattendedPendingWorkspaceFailure,
  pendingWorkspaceFailureNoticeOwnsFailure,
} from "#product/hooks/workspaces/workflows/pending-workspace-failure-notice";
import { setAppNavigate } from "#product/lib/workflows/app/app-navigate-handoff";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

const mocks = vi.hoisted(() => ({
  showProductErrorToast: vi.fn(),
  showProductToast: vi.fn(),
}));

vi.mock("#product/components/feedback/product-toast", () => ({
  showProductErrorToast: mocks.showProductErrorToast,
  showProductToast: mocks.showProductToast,
}));

function entry(attemptId: string): PendingWorkspaceEntry {
  return {
    ...buildSubmittingPendingWorkspaceEntry({
      attemptId,
      selectedWorkspaceId: null,
      source: "worktree-created",
      displayName: attemptId,
      request: {
        kind: "worktree",
        input: {
          repoRootId: "repo-root-1",
          workspaceName: attemptId,
          branchName: attemptId,
          baseBranch: "main",
          targetPath: `/tmp/landing/${attemptId}`,
        },
      },
    }),
    stage: "failed",
    errorMessage: "Branch already exists",
  };
}

describe("unattended pending workspace failure notice", () => {
  const failing = entry("attempt-failing");
  const running = entry("attempt-running");

  beforeEach(() => {
    mocks.showProductErrorToast.mockClear();
    useSessionSelectionStore.getState().clearSelection();
    useSessionSelectionStore.setState({
      pendingWorkspaces: [failing, { ...running, stage: "submitting", errorMessage: null }]
        .reduce(upsertPendingWorkspaceEntry, EMPTY_PENDING_WORKSPACE_REGISTRY),
    });
  });

  it("raises one toast when the failure happened out of sight", () => {
    // The user is watching the other launch, so the failed attempt has no
    // shell to state its error in.
    useSessionSelectionStore.setState({
      selectedLogicalWorkspaceId: buildPendingWorkspaceUiKey(running),
    });

    notifyUnattendedPendingWorkspaceFailure(failing, "Branch already exists");

    expect(mocks.showProductErrorToast).toHaveBeenCalledTimes(1);
    const input = mocks.showProductErrorToast.mock.calls[0]?.[0];
    expect(input.headline).toBe("Workspace creation failed");
    expect(input.cause).toBe("Branch already exists");
    expect(input.details.kind).toBe("navigate");
    expect(input.details.label).toBe("Show");
    // Per-attempt id, so a second failing launch stacks its own toast rather
    // than replacing this one.
    expect(input.id).toBe(`pending-workspace-failure:${failing.attemptId}`);
  });

  it("leaves the other attempt alone and never takes over its shell", () => {
    useSessionSelectionStore.setState({
      selectedLogicalWorkspaceId: buildPendingWorkspaceUiKey(running),
    });

    notifyUnattendedPendingWorkspaceFailure(failing, "Branch already exists");

    const selection = useSessionSelectionStore.getState();
    expect(selection.selectedLogicalWorkspaceId)
      .toBe(buildPendingWorkspaceUiKey(running));
    expect(selection.pendingWorkspaces.attemptOrder)
      .toEqual(["attempt-failing", "attempt-running"]);
  });

  it("says nothing when the user is already looking at the failure", () => {
    useSessionSelectionStore.setState({
      selectedLogicalWorkspaceId: buildPendingWorkspaceUiKey(failing),
    });

    notifyUnattendedPendingWorkspaceFailure(failing, "Branch already exists");

    expect(mocks.showProductErrorToast).not.toHaveBeenCalled();
  });

  it("takes the user to the failed attempt when they follow the pointer", () => {
    useSessionSelectionStore.setState({
      selectedLogicalWorkspaceId: buildPendingWorkspaceUiKey(running),
    });

    notifyUnattendedPendingWorkspaceFailure(failing, "Branch already exists");
    mocks.showProductErrorToast.mock.calls[0]?.[0].details.onNavigate();

    expect(useSessionSelectionStore.getState().selectedLogicalWorkspaceId)
      .toBe(buildPendingWorkspaceUiKey(failing));
    // Attending the failure does not end the other launch.
    expect(useSessionSelectionStore.getState().pendingWorkspaces.attemptOrder)
      .toEqual(["attempt-failing", "attempt-running"]);
  });

  // PR #1870 review finding 6: the workspace host is hidden on /workflows and
  // /workspaces, so selection alone leaves the click with nothing to show.
  it("routes to the workspace shell before selecting, like every other entry point", () => {
    const navigate = vi.fn();
    setAppNavigate(navigate);
    try {
      useSessionSelectionStore.setState({
        selectedLogicalWorkspaceId: buildPendingWorkspaceUiKey(running),
      });

      notifyUnattendedPendingWorkspaceFailure(failing, "Branch already exists");
      mocks.showProductErrorToast.mock.calls[0]?.[0].details.onNavigate();

      expect(navigate.mock.calls[0]?.[0]).toBe("/");
    } finally {
      setAppNavigate(null);
    }
  });

  describe("ownership of the announcement", () => {
    it("owns an unattended failure, so the launch toast stays quiet", () => {
      useSessionSelectionStore.setState({
        selectedLogicalWorkspaceId: buildPendingWorkspaceUiKey(running),
      });

      expect(pendingWorkspaceFailureNoticeOwnsFailure(failing.attemptId)).toBe(true);
    });

    it("leaves an attended failure to the shell's own receipt", () => {
      useSessionSelectionStore.setState({
        selectedLogicalWorkspaceId: buildPendingWorkspaceUiKey(failing),
      });

      expect(pendingWorkspaceFailureNoticeOwnsFailure(failing.attemptId)).toBe(false);
    });

    it("claims nothing for an attempt that never failed or never existed", () => {
      expect(pendingWorkspaceFailureNoticeOwnsFailure(running.attemptId)).toBe(false);
      expect(pendingWorkspaceFailureNoticeOwnsFailure(null)).toBe(false);
    });
  });
});
