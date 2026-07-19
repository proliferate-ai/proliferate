import { describe, expect, it } from "vitest";
import {
  WORKSPACE_UI_DEFAULTS,
  WORKSPACE_UI_MIGRATION_VERSION,
  type WorkspaceUiChangeTrackedState,
} from "#product/lib/domain/preferences/workspace-ui/model";
import {
  getChangedWorkspaceUiStateKeys,
  isNonPersistedWorkspaceUiStateKey,
  selectPersistedWorkspaceUiState,
} from "#product/lib/domain/preferences/workspace-ui/persistence";
import {
  fileViewerTarget,
  promptAttachmentViewerTarget,
  viewerTargetKey,
} from "#product/lib/domain/workspaces/viewer/viewer-target";

describe("workspace UI state persistence", () => {
  it("sanitizes persisted chat slices and excludes non-persisted runtime state", () => {
    const selected = selectPersistedWorkspaceUiState({
      ...WORKSPACE_UI_DEFAULTS,
      migrationVersion: 3,
      lastViewedSessionByWorkspace: {
        "workspace-1": "session-1",
        "workspace-2": "client-session:tmp",
      },
      visibleChatSessionIdsByWorkspace: {
        "workspace-1": [
          "session-1",
          "client-session:tmp",
          "session-1",
          "pending-session:tmp",
        ],
      },
      recentlyHiddenChatSessionIdsByWorkspace: {
        "workspace-1": ["session-2", "pending-session:tmp"],
      },
      collapsedChatGroupsByWorkspace: {
        "workspace-1": ["session-2", "session-2", "client-session:tmp"],
      },
      manualChatGroupsByWorkspace: {
        "workspace-1": [{
          id: "manual:review",
          label: " Review ",
          colorId: "magenta",
          sessionIds: ["session-1", "client-session:tmp", "session-2", "session-2"],
        }],
        "workspace-2": [{
          id: "manual:transient",
          label: "Transient",
          colorId: "blue",
          sessionIds: ["client-session:one", "pending-session:two"],
        }],
      },
      shellActivationEpochByWorkspace: { "workspace-1": 2 },
      pendingChatActivationByWorkspace: { "workspace-1": { kind: "chat" } },
      urgentHighlightedChatSessionByWorkspace: { "workspace-1": "session-1" },
    } as WorkspaceUiChangeTrackedState);

    expect(selected.migrationVersion).toBe(WORKSPACE_UI_MIGRATION_VERSION);
    expect(selected.lastViewedSessionByWorkspace).toEqual({
      "workspace-1": "session-1",
    });
    expect(selected.visibleChatSessionIdsByWorkspace).toEqual({
      "workspace-1": ["session-1"],
    });
    expect(selected.recentlyHiddenChatSessionIdsByWorkspace).toEqual({
      "workspace-1": ["session-2"],
    });
    expect(selected.collapsedChatGroupsByWorkspace).toEqual({
      "workspace-1": ["session-2"],
    });
    expect(selected.manualChatGroupsByWorkspace).toEqual({
      "workspace-1": [{
        id: "manual:review",
        label: "Review",
        colorId: "magenta",
        sessionIds: ["session-1", "session-2"],
      }],
    });
    expect(selected).not.toHaveProperty("shellActivationEpochByWorkspace");
    expect(selected).not.toHaveProperty("pendingChatActivationByWorkspace");
    expect(selected).not.toHaveProperty("urgentHighlightedChatSessionByWorkspace");
  });

  it("tracks persisted and runtime-only keys separately", () => {
    const previous = {
      ...WORKSPACE_UI_DEFAULTS,
      shellActivationEpochByWorkspace: {},
      pendingChatActivationByWorkspace: {},
      urgentHighlightedChatSessionByWorkspace: {},
    } satisfies WorkspaceUiChangeTrackedState;
    const next = {
      ...previous,
      sidebarOpen: true,
      shellActivationEpochByWorkspace: { "workspace-1": 1 },
      urgentHighlightedChatSessionByWorkspace: { "workspace-1": "session-1" },
    } satisfies WorkspaceUiChangeTrackedState;

    expect(getChangedWorkspaceUiStateKeys(previous, next)).toEqual([
      "sidebarOpen",
      "shellActivationEpochByWorkspace",
      "urgentHighlightedChatSessionByWorkspace",
    ]);
    expect(isNonPersistedWorkspaceUiStateKey("shellActivationEpochByWorkspace")).toBe(true);
    expect(isNonPersistedWorkspaceUiStateKey("pendingChatActivationByWorkspace")).toBe(true);
    expect(isNonPersistedWorkspaceUiStateKey("urgentHighlightedChatSessionByWorkspace")).toBe(true);
    expect(isNonPersistedWorkspaceUiStateKey("sidebarOpen")).toBe(false);
  });

  it("strips attachment preview targets from every persisted viewer surface", () => {
    const attachmentKey = viewerTargetKey(promptAttachmentViewerTarget({
      origin: "draft",
      attachmentId: "attachment:one",
      name: "paste.txt",
      mimeType: "text/plain",
      attachmentKind: "text_resource",
      attachmentSource: "paste",
      objectUrl: "blob:attachment-one",
    }));
    const fileKey = viewerTargetKey(fileViewerTarget("README.md"));

    const selected = selectPersistedWorkspaceUiState({
      ...WORKSPACE_UI_DEFAULTS,
      activeShellTabKeyByWorkspace: { w1: attachmentKey },
      shellTabOrderByWorkspace: { w1: [attachmentKey, fileKey] },
      rightPanelMaterializedByWorkspace: {
        w1: {
          activeEntryKey: attachmentKey,
          headerOrder: [attachmentKey, fileKey],
        },
      },
    });

    expect(selected.activeShellTabKeyByWorkspace).toEqual({});
    expect(selected.shellTabOrderByWorkspace).toEqual({ w1: [fileKey] });
    expect(selected.rightPanelMaterializedByWorkspace.w1).toEqual({
      activeEntryKey: "tool:scratch",
      headerOrder: [fileKey, "tool:scratch", "tool:git"],
    });
  });
});
