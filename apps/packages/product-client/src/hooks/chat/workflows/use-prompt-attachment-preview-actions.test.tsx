// @vitest-environment jsdom

import type { ReactNode } from "react";
import type { PromptCapabilities } from "@anyharness/sdk";
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AnyHarnessRuntime, AnyHarnessWorkspace } from "@anyharness/sdk-react";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePromptAttachmentPreviewActions } from "#product/hooks/chat/workflows/use-prompt-attachment-preview-actions";
import { usePromptAttachments } from "#product/hooks/chat/ui/use-prompt-attachments";
import { WORKSPACE_UI_DEFAULTS } from "#product/lib/domain/preferences/workspace-ui/model";
import { viewerTargetKey } from "#product/lib/domain/workspaces/viewer/viewer-target";
import { useWorkspaceViewerTabsStore } from "#product/stores/editor/workspace-viewer-tabs-store";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { makeTestProductHost } from "#product/test/product-host-fixtures";
import { normalizeDraftAttachments } from "@proliferate/product-domain/chats/composer/prompt-display-parts";

const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;
const promptCapabilities: PromptCapabilities = {
  image: true,
  audio: false,
  embeddedContext: true,
};

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
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn((blob: Blob) => (
        `blob:${blob instanceof File ? blob.name : blob.size}`
      )),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: originalCreateObjectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: originalRevokeObjectUrl,
    });
  });

  it("opens a draft in the right viewer and removes it when the draft is discarded", () => {
    const wrapper = createTestWrapper();
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

  it("releases scoped and unmounted draft previews before revoking each URL once", () => {
    const wrapper = createTestWrapper();
    const targetKeyByUrl = new Map<string, string>();
    vi.mocked(URL.revokeObjectURL).mockImplementation((objectUrl) => {
      const targetKey = targetKeyByUrl.get(String(objectUrl));
      if (!targetKey) {
        return;
      }
      expect(useWorkspaceViewerTabsStore.getState().openTargets.some((target) => (
        viewerTargetKey(target) === targetKey
      ))).toBe(false);
      for (const panelState of Object.values(
        useWorkspaceUiStore.getState().rightPanelMaterializedByWorkspace,
      )) {
        expect(panelState.headerOrder).not.toContain(targetKey);
        expect(panelState.activeEntryKey).not.toBe(targetKey);
      }
    });
    const { result, rerender, unmount } = renderHook(
      ({ scopeKey }: { scopeKey: string }) => {
        const previewActions = usePromptAttachmentPreviewActions();
        const attachments = usePromptAttachments(scopeKey, promptCapabilities, {
          onBeforeReleaseAttachments: (outgoing) => {
            previewActions.closeDraftAttachmentPreviews(
              outgoing.map((attachment) => attachment.id),
            );
          },
        });
        return { attachments, previewActions };
      },
      { initialProps: { scopeKey: "logical-workspace-1" }, wrapper },
    );

    act(() => {
      result.current.attachments.addFiles([
        new File(["first"], "first.txt", { type: "text/plain" }),
      ]);
    });
    const first = result.current.attachments.attachments[0]!;
    act(() => {
      result.current.previewActions.openAttachmentPreview({
        origin: "draft",
        sessionId: null,
        part: previewPart(first),
      });
    });
    const firstTargetKey = viewerTargetKey(
      useWorkspaceViewerTabsStore.getState().openTargets[0]!,
    );
    targetKeyByUrl.set(first.objectUrl!, firstTargetKey);

    act(() => {
      useSessionSelectionStore.getState().activateWorkspace({
        logicalWorkspaceId: "logical-workspace-2",
        workspaceId: "workspace-2",
      });
    });
    rerender({ scopeKey: "logical-workspace-2" });

    expect(useWorkspaceViewerTabsStore.getState().openTargets).toEqual([]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(first.objectUrl);
    expect(vi.mocked(URL.revokeObjectURL).mock.calls.filter(
      ([objectUrl]) => objectUrl === first.objectUrl,
    )).toHaveLength(1);

    act(() => {
      result.current.attachments.addFiles([
        new File(["second"], "second.txt", { type: "text/plain" }),
      ]);
    });
    const second = result.current.attachments.attachments[0]!;
    act(() => {
      result.current.previewActions.openAttachmentPreview({
        origin: "draft",
        sessionId: null,
        part: previewPart(second),
      });
    });
    const secondTargetKey = viewerTargetKey(
      useWorkspaceViewerTabsStore.getState().openTargets[0]!,
    );
    targetKeyByUrl.set(second.objectUrl!, secondTargetKey);

    unmount();

    expect(useWorkspaceViewerTabsStore.getState().openTargets).toEqual([]);
    expect(vi.mocked(URL.revokeObjectURL).mock.calls.filter(
      ([objectUrl]) => objectUrl === second.objectUrl,
    )).toHaveLength(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});

function createTestWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
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
}

function previewPart(
  attachment: Parameters<typeof normalizeDraftAttachments>[0][number],
) {
  const part = normalizeDraftAttachments([attachment])[0];
  if (!part || (part.type !== "image" && part.type !== "file")) {
    throw new Error("Expected a previewable draft attachment");
  }
  return part;
}
