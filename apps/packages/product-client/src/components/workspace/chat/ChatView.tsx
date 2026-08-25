import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type JSX,
} from "react";
import { useChatLoadingHeroExit } from "#product/hooks/chat/ui/use-chat-loading-hero-exit";
import { ChatLoadingHeroExitOverlay } from "#product/components/workspace/chat/surface/ChatLoadingHeroExitOverlay";
import { ChatInput } from "#product/components/workspace/chat/input/ChatInput";
import { ChatComposerDock } from "#product/components/workspace/chat/input/ChatComposerDock";
import { TodoProgressPill } from "#product/components/workspace/chat/input/TodoProgressPill";
import { DebugProfiler } from "#product/components/diagnostics/DebugProfiler";
import { ChatLaunchIntentPane } from "#product/components/workspace/chat/surface/ChatLaunchIntentPane";
import { ChatLoadingHero } from "#product/components/workspace/chat/surface/ChatLoadingHero";
import { ChatPreMessageCanvas } from "#product/components/workspace/chat/surface/ChatPreMessageCanvas";
import { ChatReadyHero } from "#product/components/workspace/chat/surface/ChatReadyHero";
import { NoWorkspaceState } from "#product/components/workspace/chat/surface/NoWorkspaceState";
import { SessionTranscriptPane } from "#product/components/workspace/chat/surface/SessionTranscriptPane";
import { WorkspaceCreationReceipt } from "#product/components/workspace/chat/transcript/WorkspaceCreationReceipt";
import { TranscriptSwitchingPlaceholder } from "#product/components/workspace/chat/surface/TranscriptSwitchingPlaceholder";
import { type ChatSurfaceState, useChatSurfaceState } from "#product/hooks/chat/derived/use-chat-surface-state";
import {
  useActiveSessionId,
  useActiveSessionPromptCapabilities,
  useSelectedWorkspaceUiKey,
} from "#product/hooks/chat/derived/use-active-session-identity";
import { useChatAvailabilityState } from "#product/hooks/chat/derived/use-chat-availability-state";
import { useChatDockInset } from "#product/hooks/chat/ui/use-chat-dock-inset";
import { useChatPromptAttachments } from "#product/hooks/chat/ui/use-chat-prompt-attachments";
import { useChatRootFocus } from "#product/hooks/chat/ui/use-chat-root-focus";
import { useComposerDockSlots } from "#product/hooks/chat/ui/use-composer-dock-slots";
import { useQueuedPromptEditStatus } from "#product/hooks/chat/ui/use-queued-prompt-edit";
import { useDebugRenderCount } from "#product/hooks/ui/debug/use-debug-render-count";
import { useSessionErrorAcknowledgement } from "#product/hooks/sessions/lifecycle/use-session-error-acknowledgement";
import { useSelectedCloudRuntimeRehydration } from "#product/hooks/workspaces/lifecycle/use-selected-cloud-runtime-rehydration";
import { useTerminalConnectionPrewarm } from "#product/hooks/terminals/lifecycle/use-terminal-connection-prewarm";
import { useSelectedCloudRuntimeState } from "#product/hooks/workspaces/facade/use-selected-cloud-runtime-state";
import { canAttachPromptContent } from "#product/domain/chats/composer/prompt-attachment-rules";
import {
  canAcceptChatFileDrop,
  isFileDrag,
  readFileDragInput,
} from "#product/lib/domain/chat/composer/prompt-attachment-drag";
import { isCloudWorkspaceId } from "#product/lib/domain/workspaces/cloud/cloud-ids";
import type { WorkspaceRenderSurface } from "#product/lib/domain/workspaces/tabs/shell-activation";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { usePromptAttachmentPreviewActions } from "#product/hooks/chat/workflows/use-prompt-attachment-preview-actions";

const WorkspaceSessionRecoveryInlinePanel = lazy(() =>
  import("#product/components/workspace/chat/surface/WorkspaceSessionRecoveryInlinePanel")
);

function ChatContent({
  dockSafeAreaPx,
  mode,
  stickyBottomInsetPx,
  stickyNonDisplacingBottomInsetPx,
}: {
  dockSafeAreaPx: number;
  mode: ChatSurfaceState;
  stickyBottomInsetPx: number;
  stickyNonDisplacingBottomInsetPx: number;
}): JSX.Element | null {
  const isHeroMode = mode.kind === "workspace-status" || mode.kind === "session-loading";
  const { phase: heroExitPhase, handleTreatmentShown } = useChatLoadingHeroExit(isHeroMode);

  const content = (() => {
    switch (mode.kind) {
      case "no-workspace":
        return <NoWorkspaceState bottomInsetPx={dockSafeAreaPx} />;
      case "launch-intent":
        return (
          <ChatLaunchIntentPane
            bottomInsetPx={stickyBottomInsetPx}
            nonDisplacingBottomInsetPx={stickyNonDisplacingBottomInsetPx}
          />
        );
      case "workspace-status":
      case "session-loading":
        return (
          <ChatPreMessageCanvas
            bottomInsetPx={dockSafeAreaPx}
            topSlot={<WorkspaceCreationReceipt pendingOnly />}
          >
            <ChatLoadingHero onTreatmentShown={handleTreatmentShown} />
          </ChatPreMessageCanvas>
        );
      case "session-hydrating":
        return (
          <SessionTranscriptPane
            bottomInsetPx={stickyBottomInsetPx}
            nonDisplacingBottomInsetPx={stickyNonDisplacingBottomInsetPx}
          />
        );
      case "session-switching":
        return <TranscriptSwitchingPlaceholder />;
      case "session-empty":
        return (
          <ChatPreMessageCanvas
            bottomInsetPx={dockSafeAreaPx}
            topSlot={<WorkspaceCreationReceipt pendingOnly />}
          >
            <ChatReadyHero />
          </ChatPreMessageCanvas>
        );
      case "session-transcript":
        return (
          <SessionTranscriptPane
            bottomInsetPx={stickyBottomInsetPx}
            nonDisplacingBottomInsetPx={stickyNonDisplacingBottomInsetPx}
          />
        );
    }
  })();

  if (heroExitPhase === "idle") {
    return content;
  }

  return (
    <div className="relative h-full w-full" data-chat-loading-hero-exit-wrapper>
      {content}
      <ChatLoadingHeroExitOverlay dockSafeAreaPx={dockSafeAreaPx} phase={heroExitPhase} />
    </div>
  );
}

function shouldShowSessionInputChrome(mode: ChatSurfaceState): boolean {
  switch (mode.kind) {
    case "workspace-status":
    case "session-loading":
    case "session-hydrating":
    case "session-empty":
    case "session-switching":
    case "session-transcript":
      return true;
    case "no-workspace":
      return false;
    case "launch-intent":
      return true;
  }
}

export const ChatView = memo(function ChatView({
  shellRenderSurface = null,
  showWorkspaceStatusPanels = true,
}: {
  shellRenderSurface?: WorkspaceRenderSurface | null;
  showWorkspaceStatusPanels?: boolean;
}) {
  useDebugRenderCount("chat-surface");
  const { mode } = useChatSurfaceState(shellRenderSurface);
  const suppressSessionSlots = shellRenderSurface?.kind === "chat-shell"
    || shellRenderSurface?.kind === "chat-session-pending";
  const suppressComposerActiveSessionState = shellRenderSurface?.kind === "chat-session-pending";
  const replacementSessionId = shellRenderSurface?.kind === "chat-session-pending"
    ? shellRenderSurface.sessionId
    : null;
  const activeSessionId = useActiveSessionId();
  const workspaceSessionRecovery = useSessionSelectionStore(
    (state) => state.workspaceSessionRecovery,
  );
  const activeWorkspaceSessionRecovery = workspaceSessionRecovery?.sessionId === activeSessionId
    ? workspaceSessionRecovery
    : null;
  const workspaceUiKey = useSelectedWorkspaceUiKey();
  const activePromptCapabilities = useActiveSessionPromptCapabilities();
  const availability = useChatAvailabilityState();
  const queuedPromptEditStatus = useQueuedPromptEditStatus();
  const selectedCloudRuntime = useSelectedCloudRuntimeState();
  const isSessionMode = shouldShowSessionInputChrome(mode);
  const composerDockSlots = useComposerDockSlots({
    suppressSessionSlots,
  });
  const promptCapabilities = suppressComposerActiveSessionState
    ? null
    : activePromptCapabilities;
  const supportsAttachments = canAttachPromptContent(promptCapabilities);
  const canAcceptFileDrop = canAcceptChatFileDrop({
    isEditingQueuedPrompt: queuedPromptEditStatus.isEditing,
    isDisabled: availability.isDisabled,
    areRuntimeControlsDisabled: availability.areRuntimeControlsDisabled,
    hasActiveSession: !suppressComposerActiveSessionState && !!activeSessionId,
    supportsAttachments,
  });
  const { closeDraftAttachmentPreviews } = usePromptAttachmentPreviewActions();
  const host = useProductHost();
  const desktopFiles = host.desktop?.files ?? null;
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  // The drag pasteboard change count captured while the current drag session
  // is over this surface; binds the drop's path snapshot to that session.
  // Held as one promise per drag session: a promise's value cannot be
  // clobbered by a later session's capture, and a drop that lands before the
  // capture resolves awaits it instead of skipping the comparison.
  const dragSessionChangeCountRef = useRef<Promise<number> | null>(null);
  const pendingDropChangeCountRef = useRef<Promise<number> | null>(null);
  // Dropped-path recovery only makes sense when the agent shares this
  // machine's filesystem. Mirrors resolveRuntimeTargetForWorkspace: `cloud:*`
  // runs in a cloud sandbox that cannot read this machine's paths, while
  // everything else is the local runtime.
  const resolveDroppedPaths = useMemo(() => {
    const isLocalRuntimeWorkspace = !!selectedWorkspaceId
      && !isCloudWorkspaceId(selectedWorkspaceId);
    if (!desktopFiles || !isLocalRuntimeWorkspace) {
      return null;
    }
    return async () => {
      const expectedChangeCount = pendingDropChangeCountRef.current;
      pendingDropChangeCountRef.current = null;
      // No captured drag session means the snapshot cannot be attributed;
      // empty entries route the drop to byte uploads.
      if (!expectedChangeCount) {
        return [];
      }
      const [snapshot, expected] = await Promise.all([
        desktopFiles.readDroppedPaths(),
        expectedChangeCount,
      ]);
      // A different drag session wrote the pasteboard after this drop's drag
      // entered the surface.
      return snapshot.changeCount === expected ? snapshot.entries : [];
    };
  }, [desktopFiles, selectedWorkspaceId]);
  const promptAttachments = useChatPromptAttachments({
    scopeKey: workspaceUiKey,
    promptCapabilities,
    canAttachFiles: canAcceptFileDrop,
    resolveDroppedPaths,
    onBeforeReleaseAttachments: (attachments) => {
      closeDraftAttachmentPreviews(attachments.map((attachment) => attachment.id));
    },
  });
  const [fileDragOver, setFileDragOver] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const {
    dockRef,
    dockSafeAreaPx,
    lowerBackdropTopPx,
    stickyBottomInsetPx,
    stickyNonDisplacingBottomInsetPx,
  } = useChatDockInset();

  useSelectedCloudRuntimeRehydration(selectedCloudRuntime);
  // Q16: warm the gateway token at workspace selection so pane
  // activation consumes a pre-warmed connection (silent, lazy-path fallback).
  useTerminalConnectionPrewarm();
  useSessionErrorAcknowledgement();

  // The composer placeholder flips to the follow-up variant once the session
  // transcript already has turns; the surface mode is the cheap signal.
  const hasSessionTurns = mode.kind === "session-transcript";
  const chatInput = useMemo(() => (
    <ChatInput
      attachments={promptAttachments}
      suppressActiveSessionState={suppressComposerActiveSessionState}
      suppressAutoFocus={activeWorkspaceSessionRecovery !== null}
      suppressWorkspaceTakeover={!showWorkspaceStatusPanels}
      replacementSessionId={replacementSessionId}
      hasSessionTurns={hasSessionTurns}
    />
  ), [
    hasSessionTurns,
    activeWorkspaceSessionRecovery,
    promptAttachments,
    replacementSessionId,
    showWorkspaceStatusPanels,
    suppressComposerActiveSessionState,
  ]);

  const handleFileDrag = useCallback((event: DragEvent<HTMLDivElement>) => {
    const dragInput = readFileDragInput(event.dataTransfer);
    if (!isFileDrag(dragInput)) {
      return false;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = canAcceptFileDrop ? "copy" : "none";
    setFileDragOver(canAcceptFileDrop);
    if (dragSessionChangeCountRef.current === null && desktopFiles && resolveDroppedPaths) {
      // Arm once per drag session; the count identifies the session that
      // will deliver the drop.
      dragSessionChangeCountRef.current = desktopFiles.getDragPasteboardChangeCount();
    }
    return true;
  }, [canAcceptFileDrop, desktopFiles, resolveDroppedPaths]);

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    const dragInput = readFileDragInput(event.dataTransfer);
    if (!isFileDrag(dragInput)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setFileDragOver(false);
    const sessionChangeCount = dragSessionChangeCountRef.current;
    dragSessionChangeCountRef.current = null;
    // No files.length gate: WebKit can surface folder-only drops with an
    // empty FileList, and the host path resolver still recovers those items.
    if (canAcceptFileDrop) {
      pendingDropChangeCountRef.current = sessionChangeCount;
      promptAttachments.addDroppedFiles(event.dataTransfer.files);
    }
  }, [canAcceptFileDrop, promptAttachments.addDroppedFiles]);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
      return;
    }
    setFileDragOver(false);
    dragSessionChangeCountRef.current = null;
  }, []);
  const handleRootPointerDownCapture = useChatRootFocus(rootRef);

  return (
    <DebugProfiler id="chat-surface">
      <div
        ref={rootRef}
        data-focus-zone="chat"
        tabIndex={-1}
        className="chat-selection-root relative flex h-full min-h-0 flex-1 flex-col select-none overflow-hidden outline-none"
        onPointerDownCapture={handleRootPointerDownCapture}
        onDragEnter={handleFileDrag}
        onDragOver={handleFileDrag}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
      <DebugProfiler id="chat-content">
        <div className="flex flex-1 min-h-0 flex-col">
          <ChatContent
            dockSafeAreaPx={dockSafeAreaPx}
            mode={mode}
            stickyBottomInsetPx={stickyBottomInsetPx}
            stickyNonDisplacingBottomInsetPx={stickyNonDisplacingBottomInsetPx}
          />
        </div>
      </DebugProfiler>
      {fileDragOver && (
        <div
          className="pointer-events-none absolute inset-2 z-40 rounded-xl border border-dashed border-primary/70 bg-primary/5"
          aria-hidden="true"
        />
      )}
      <DebugProfiler id="chat-composer-dock-region">
        <ChatComposerDock
          ref={dockRef}
          backdrop={isSessionMode}
          outboundSlot={composerDockSlots.outboundSlot}
          activeSlot={composerDockSlots.activeSlot}
          floatingSlot={<TodoProgressPill />}
          attachedSlot={activeWorkspaceSessionRecovery
            ? (
                <Suspense fallback={null}>
                  <WorkspaceSessionRecoveryInlinePanel
                    recovery={activeWorkspaceSessionRecovery}
                  />
                </Suspense>
              )
            : composerDockSlots.attachedSlot}
          lowerBackdropTopPx={lowerBackdropTopPx}
          shellClassName="pointer-events-none absolute inset-x-0 bottom-0"
          data-telemetry-block
          data-focus-zone="chat"
        >
          {chatInput}
        </ChatComposerDock>
      </DebugProfiler>
      </div>
    </DebugProfiler>
  );
});
