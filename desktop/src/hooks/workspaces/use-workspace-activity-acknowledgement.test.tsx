// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/logical-workspaces";
import { makeLocalLogicalWorkspace } from "@/lib/domain/workspaces/sidebar-test-fixtures";
import {
  WORKSPACE_UI_DEFAULTS,
  useWorkspaceUiStore,
} from "@/stores/preferences/workspace-ui-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useWorkspaceActivityAcknowledgement } from "./use-workspace-activity-acknowledgement";

const mocks = vi.hoisted(() => ({
  focused: true,
  focusVisibilityNonce: 0,
  logicalWorkspaces: [] as LogicalWorkspace[],
}));

vi.mock("@/hooks/ui/use-document-focus-visibility", () => ({
  isDocumentVisibleAndFocused: () => mocks.focused,
  useDocumentFocusVisibilityNonce: () => mocks.focusVisibilityNonce,
}));

vi.mock("@/hooks/workspaces/use-logical-workspaces", () => ({
  useLogicalWorkspaces: () => ({
    logicalWorkspaces: mocks.logicalWorkspaces,
    isLoading: false,
  }),
}));

describe("useWorkspaceActivityAcknowledgement", () => {
  beforeEach(() => {
    mocks.focused = true;
    mocks.focusVisibilityNonce = 0;
    mocks.logicalWorkspaces = [];
    useWorkspaceUiStore.setState({
      ...WORKSPACE_UI_DEFAULTS,
      _hydrated: true,
    });
    useSessionSelectionStore.setState({
      hydrated: true,
      selectedLogicalWorkspaceId: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("acknowledges selected focused logical workspace activity with the related timestamp", async () => {
    const logicalWorkspace = makeLocalLogicalWorkspace({
      id: "logical-workspace-1",
      repoKey: "/repo",
      repoName: "repo",
    });
    const materializedWorkspaceId = logicalWorkspace.localWorkspace?.id ?? "";
    mocks.logicalWorkspaces = [logicalWorkspace];
    useSessionSelectionStore.setState({
      selectedLogicalWorkspaceId: logicalWorkspace.id,
    });
    useWorkspaceUiStore.setState({
      lastViewedAt: {
        [logicalWorkspace.id]: "2026-04-04T00:00:01.000Z",
      },
      workspaceLastInteracted: {
        [materializedWorkspaceId]: "2026-04-04T00:00:05.000Z",
      },
    });

    renderHook(() => useWorkspaceActivityAcknowledgement());

    await waitFor(() => {
      expect(useWorkspaceUiStore.getState().lastViewedAt[logicalWorkspace.id])
        .toBe("2026-04-04T00:00:05.000Z");
    });
  });

  it("does not acknowledge hidden or unfocused activity", () => {
    const logicalWorkspace = makeLocalLogicalWorkspace({
      id: "logical-workspace-1",
      repoKey: "/repo",
      repoName: "repo",
    });
    const materializedWorkspaceId = logicalWorkspace.localWorkspace?.id ?? "";
    mocks.focused = false;
    mocks.logicalWorkspaces = [logicalWorkspace];
    useSessionSelectionStore.setState({
      selectedLogicalWorkspaceId: logicalWorkspace.id,
    });
    useWorkspaceUiStore.setState({
      lastViewedAt: {
        [logicalWorkspace.id]: "2026-04-04T00:00:01.000Z",
      },
      workspaceLastInteracted: {
        [materializedWorkspaceId]: "2026-04-04T00:00:05.000Z",
      },
    });

    renderHook(() => useWorkspaceActivityAcknowledgement());

    expect(useWorkspaceUiStore.getState().lastViewedAt[logicalWorkspace.id])
      .toBe("2026-04-04T00:00:01.000Z");
  });
});
