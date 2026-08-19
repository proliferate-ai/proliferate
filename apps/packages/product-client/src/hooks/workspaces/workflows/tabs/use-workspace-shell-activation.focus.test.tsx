// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WORKSPACE_UI_DEFAULTS } from "#product/lib/domain/preferences/workspace-ui/model";
import {
  allChangesViewerTarget,
  fileDiffViewerTarget,
  fileViewerTarget,
  promptAttachmentViewerTarget,
  viewerTargetKey,
} from "#product/lib/domain/workspaces/viewer/viewer-target";
import { useContentSearchStore } from "#product/stores/search/content-search-store";
import { useWorkspaceViewerTabsStore } from "#product/stores/editor/workspace-viewer-tabs-store";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import { useWorkspaceShellActivation } from "#product/hooks/workspaces/workflows/tabs/use-workspace-shell-activation";

// The chat half of this hook drags in the runtime host; this suite proves the
// viewer-activation focus contract only, so the chat seam is stubbed out.
vi.mock("#product/hooks/workspaces/workflows/tabs/use-chat-tab-activation", () => ({
  useChatTabActivation: () => vi.fn(),
  cancelPendingDeferredChatActivation: vi.fn(),
  clearCurrentPendingForWorkspace: vi.fn(),
}));

const WORKSPACE_ID = "workspace-1";
const SHELL_ID = "logical-workspace-1";

function activation() {
  return renderHook(() => useWorkspaceShellActivation()).result;
}

function focusRequest() {
  return useWorkspaceViewerTabsStore.getState().viewerFocusRequest;
}

beforeEach(() => {
  useWorkspaceViewerTabsStore.getState().reset();
  useContentSearchStore.setState({ open: false, closeSuppressRestoreToken: 0 });
  useWorkspaceUiStore.setState({ ...WORKSPACE_UI_DEFAULTS, _hydrated: true });
});

describe("activateViewerTarget focus intent", () => {
  it.each([
    ["file", fileViewerTarget("src/index.tsx")],
    ["fileDiff", fileDiffViewerTarget({ path: "src/index.tsx", scope: "unstaged" })],
  ])(
    "mints a viewer-focus request for an external %s activation that states no intent",
    (_kind, target) => {
      const result = activation();

      act(() => {
        result.current.activateViewerTarget({
          workspaceId: WORKSPACE_ID,
          shellWorkspaceId: SHELL_ID,
          target,
        });
      });

      expect(focusRequest()).toEqual({
        targetKey: viewerTargetKey(target),
        token: expect.any(Number),
      });
      expect(focusRequest()?.token).toBeGreaterThan(0);
    },
  );

  it("mints no request for a preserve-origin activation", () => {
    const result = activation();

    act(() => {
      result.current.activateViewerTarget({
        workspaceId: WORKSPACE_ID,
        shellWorkspaceId: SHELL_ID,
        target: fileViewerTarget("src/index.tsx"),
        focus: "preserve-origin",
      });
    });

    expect(focusRequest()).toBeNull();
  });

  it.each([
    [
      "promptAttachment",
      promptAttachmentViewerTarget({
        origin: "draft",
        attachmentId: "draft-1",
        name: "notes.md",
        mimeType: "text/markdown",
        attachmentKind: "text_resource",
        attachmentSource: "upload",
        objectUrl: "blob:draft-1",
      }),
    ],
    ["allChanges", allChangesViewerTarget({ scope: "working_tree_composite" })],
  ])("never mints a request for a %s target even with viewer intent", (_kind, target) => {
    const result = activation();

    act(() => {
      result.current.activateViewerTarget({
        workspaceId: WORKSPACE_ID,
        shellWorkspaceId: SHELL_ID,
        target,
        focus: "viewer",
      });
    });

    expect(focusRequest()).toBeNull();
  });

  it("re-activating the already-selected target mints a fresh request", () => {
    const target = fileViewerTarget("src/index.tsx");
    const result = activation();

    act(() => {
      result.current.activateViewerTarget({
        workspaceId: WORKSPACE_ID, shellWorkspaceId: SHELL_ID, target,
      });
    });
    const first = focusRequest()?.token ?? 0;
    // Simulate the frame consuming the first request before the retrigger.
    act(() => {
      useWorkspaceViewerTabsStore.getState().consumeViewerFocusRequest(first);
    });
    expect(focusRequest()).toBeNull();

    act(() => {
      result.current.activateViewerTarget({
        workspaceId: WORKSPACE_ID, shellWorkspaceId: SHELL_ID, target,
      });
    });

    expect(focusRequest()?.targetKey).toBe(viewerTargetKey(target));
    expect(focusRequest()?.token).toBeGreaterThan(first);
  });

  it("invalidates an unconsumed request when another target is activated", () => {
    const first = fileViewerTarget("src/first.tsx");
    const result = activation();

    act(() => {
      result.current.activateViewerTarget({
        workspaceId: WORKSPACE_ID, shellWorkspaceId: SHELL_ID, target: first,
      });
    });
    const staleToken = focusRequest()?.token ?? 0;

    act(() => {
      result.current.activateViewerTarget({
        workspaceId: WORKSPACE_ID,
        shellWorkspaceId: SHELL_ID,
        target: fileViewerTarget("src/second.tsx"),
        focus: "preserve-origin",
      });
    });

    expect(focusRequest()).toBeNull();
    // A late consume for the stale token cannot resurrect or clear anything.
    act(() => {
      useWorkspaceViewerTabsStore.getState().consumeViewerFocusRequest(staleToken);
    });
    expect(focusRequest()).toBeNull();
  });

  it("writes no request when no activation happens (pre-activation failure)", () => {
    activation();

    expect(focusRequest()).toBeNull();
    expect(useContentSearchStore.getState().closeSuppressRestoreToken).toBe(0);
  });

  it.each([
    ["preserve-origin", "preserve-origin" as const],
    ["viewer", "viewer" as const],
  ])("dismisses an open search with restoration suppressed for %s", (_label, focus) => {
    const result = activation();
    act(() => {
      useContentSearchStore.getState().openSearch("file");
    });

    act(() => {
      result.current.activateViewerTarget({
        workspaceId: WORKSPACE_ID,
        shellWorkspaceId: SHELL_ID,
        target: fileViewerTarget("src/second.tsx"),
        focus,
      });
    });

    const search = useContentSearchStore.getState();
    expect(search.open).toBe(false);
    // Suppressed: the outgoing file's Find control cannot reclaim focus.
    expect(search.closeSuppressRestoreToken).toBe(1);
  });

  it("does not burn a suppression token when no search is open", () => {
    const result = activation();

    act(() => {
      result.current.activateViewerTarget({
        workspaceId: WORKSPACE_ID,
        shellWorkspaceId: SHELL_ID,
        target: fileViewerTarget("src/index.tsx"),
      });
    });

    expect(useContentSearchStore.getState().closeSuppressRestoreToken).toBe(0);
  });
});
