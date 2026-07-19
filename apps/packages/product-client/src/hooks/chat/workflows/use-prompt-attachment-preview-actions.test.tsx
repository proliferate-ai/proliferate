// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AnyHarnessRuntime, AnyHarnessWorkspace } from "@anyharness/sdk-react";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { usePromptAttachmentPreviewActions } from "#product/hooks/chat/workflows/use-prompt-attachment-preview-actions";
import { WORKSPACE_UI_DEFAULTS } from "#product/lib/domain/preferences/workspace-ui/model";
import { viewerTargetKey } from "#product/lib/domain/workspaces/viewer/viewer-target";
import { useWorkspaceViewerTabsStore } from "#product/stores/editor/workspace-viewer-tabs-store";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { makeTestProductHost } from "#product/test/product-host-fixtures";

describe("usePromptAttachmentPreviewActions", () => {
  beforeEach(() => {
    useSessionSelectionStore.getState().clearSelection();
    useSessionSelectionStore.getState().activateWorkspace({
      logicalWorkspaceId: "logical-workspace-1",
      workspaceId: "workspace-1",
    });
    useWorkspaceViewerTabsStore.getState().reset();
    useWorkspaceUiStore.setState({
      ...WORKSPACE_UI_DEFAULTS,
      _hydrated: true,
      shellActivationEpochByWorkspace: {},
      pendingChatActivationByWorkspace: {},
      urgentHighlightedChatSessionByWorkspace: {},
    });
  });

  afterEach(cleanup);

  it("opens a draft in the right viewer and removes it when the draft is discarded", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <ProductHostProvider host={makeTestProductHost()}>
          <AnyHarnessRuntime runtimeUrl={null}>
            <AnyHarnessWorkspace
              workspaceId="workspace-1"
              resolveConnection={async () => ({
                runtimeUrl: "http://127.0.0.1:1",
                anyharnessWorkspaceId: "workspace-1",
              })}
            >
              {children}
            </AnyHarnessWorkspace>
          </AnyHarnessRuntime>
        </ProductHostProvider>
      </QueryClientProvider>
    );
    const { result } = renderHook(() => usePromptAttachmentPreviewActions(), { wrapper });

    act(() => {
      result.current.openAttachmentPreview({
        origin: "draft",
        sessionId: null,
        part: {
          type: "file",
          id: "draft-1",
          name: "notes.md",
          mimeType: "text/markdown",
          size: 128,
          source: "paste",
          objectUrl: "blob:draft-1",
        },
      });
    });

    const target = useWorkspaceViewerTabsStore.getState().openTargets[0];
    expect(target).toMatchObject({
      kind: "promptAttachment",
      origin: "draft",
      attachmentId: "draft-1",
      objectUrl: "blob:draft-1",
    });
    const targetKey = viewerTargetKey(target!);
    expect(useWorkspaceUiStore.getState().rightPanelMaterializedByWorkspace["workspace-1"])
      .toMatchObject({ activeEntryKey: targetKey });
    expect(useWorkspaceUiStore.getState().rightPanelDurableByWorkspace["logical-workspace-1"])
      .toMatchObject({ open: true });

    act(() => {
      result.current.closeDraftAttachmentPreview("draft-1");
    });

    expect(useWorkspaceViewerTabsStore.getState().openTargets).toEqual([]);
    expect(
      useWorkspaceUiStore.getState()
        .rightPanelMaterializedByWorkspace["workspace-1"]?.headerOrder,
    ).not.toContain(targetKey);
  });
});
