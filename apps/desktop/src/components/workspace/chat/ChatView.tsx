import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type JSX,
} from "react";
import { ChatInput } from "@/components/workspace/chat/input/ChatInput";
import { ChatComposerDock } from "@/components/workspace/chat/input/ChatComposerDock";
import { DebugProfiler } from "@/components/diagnostics/DebugProfiler";
import { ChatLaunchIntentPane } from "@/components/workspace/chat/surface/ChatLaunchIntentPane";
import { ChatLoadingHero } from "@/components/workspace/chat/surface/ChatLoadingHero";
import { ChatPreMessageCanvas } from "@/components/workspace/chat/surface/ChatPreMessageCanvas";
import { ChatReadyHero } from "@/components/workspace/chat/surface/ChatReadyHero";
import { NoWorkspaceState } from "@/components/workspace/chat/surface/NoWorkspaceState";
import { SessionTranscriptPane } from "@/components/workspace/chat/surface/SessionTranscriptPane";
import { SessionContentSearchOverlay } from "@/components/workspace/chat/surface/SessionContentSearchOverlay";
import { TranscriptSwitchingPlaceholder } from "@/components/workspace/chat/surface/TranscriptSwitchingPlaceholder";
import { type ChatSurfaceState, useChatSurfaceState } from "@/hooks/chat/derived/use-chat-surface-state";
import {
  useActiveSessionId,
  useActiveSessionPromptCapabilities,
} from "@/hooks/chat/derived/use-active-session-identity";
import { useChatAvailabilityState } from "@/hooks/chat/derived/use-chat-availability-state";
import { useChatDockInset } from "@/hooks/chat/ui/use-chat-dock-inset";
import { useChatPromptAttachments } from "@/hooks/chat/ui/use-chat-prompt-attachments";
import { useChatRootFocus } from "@/hooks/chat/ui/use-chat-root-focus";
import { useCloudWorkspacePolling } from "@/hooks/chat/lifecycle/use-cloud-workspace-polling";
import { useComposerDockSlots } from "@/hooks/chat/ui/use-composer-dock-slots";
import { useQueuedPromptEditStatus } from "@/hooks/chat/ui/use-queued-prompt-edit";
import { useDebugRenderCount } from "@/hooks/ui/debug/use-debug-render-count";
import { useSessionErrorAcknowledgement } from "@/hooks/sessions/lifecycle/use-session-error-acknowledgement";
import { useSelectedCloudRuntimeRehydration } from "@/hooks/workspaces/lifecycle/use-selected-cloud-runtime-rehydration";
import { useSelectedCloudRuntimeState } from "@/hooks/workspaces/facade/use-selected-cloud-runtime-state";
import { canAttachPromptContent } from "@proliferate/product-domain/chats/composer/prompt-attachment-rules";
import {
  canAcceptChatFileDrop,
  isFileDrag,
  readFileDragInput,
} from "@/lib/domain/chat/composer/prompt-attachment-drag";
import type { WorkspaceRenderSurface } from "@/lib/domain/workspaces/tabs/shell-activation";

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
        <ChatPreMessageCanvas bottomInsetPx={dockSafeAreaPx}>
          <ChatLoadingHero />
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
        <ChatPreMessageCanvas bottomInsetPx={dockSafeAreaPx}>
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

function shouldEnableContentSearchOverlay(mode: ChatSurfaceState): boolean {
  return mode.kind !== "no-workspace";
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
  const activeSessionId = useActiveSessionId();
  const activePromptCapabilities = useActiveSessionPromptCapabilities();
  const availability = useChatAvailabilityState();
  const queuedPromptEditStatus = useQueuedPromptEditStatus();
  const selectedCloudRuntime = useSelectedCloudRuntimeState();
  const isSessionMode = shouldShowSessionInputChrome(mode);
  const contentSearchEnabled = shouldEnableContentSearchOverlay(mode);
  const composerDockSlots = useComposerDockSlots({
    suppressSessionSlots,
    suppressWorkspaceStatusPanels: !showWorkspaceStatusPanels,
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
  const promptAttachments = useChatPromptAttachments({
    activeSessionId,
    promptCapabilities,
    canAttachFiles: canAcceptFileDrop,
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

  useCloudWorkspacePolling();
  useSelectedCloudRuntimeRehydration(selectedCloudRuntime);
  useSessionErrorAcknowledgement();

  // The composer placeholder flips to the follow-up variant once the session
  // transcript already has turns; the surface mode is the cheap signal.
  const hasSessionTurns = mode.kind === "session-transcript";
  const chatInput = useMemo(() => (
    <ChatInput
      attachments={promptAttachments}
      suppressActiveSessionState={suppressComposerActiveSessionState}
      hasSessionTurns={hasSessionTurns}
    />
  ), [hasSessionTurns, promptAttachments, suppressComposerActiveSessionState]);

  const handleFileDrag = useCallback((event: DragEvent<HTMLDivElement>) => {
    const dragInput = readFileDragInput(event.dataTransfer);
    if (!isFileDrag(dragInput)) {
      return false;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = canAcceptFileDrop ? "copy" : "none";
    setFileDragOver(canAcceptFileDrop);
    return true;
  }, [canAcceptFileDrop]);

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    const dragInput = readFileDragInput(event.dataTransfer);
    if (!isFileDrag(dragInput)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setFileDragOver(false);
    if (canAcceptFileDrop && event.dataTransfer.files.length > 0) {
      promptAttachments.addFiles(event.dataTransfer.files);
    }
  }, [canAcceptFileDrop, promptAttachments.addFiles]);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
      return;
    }
    setFileDragOver(false);
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
          className="pointer-events-none absolute inset-2 z-40 rounded-[var(--radius-composer)] border border-dashed border-primary/70 bg-primary/5"
          aria-hidden="true"
        />
      )}
      <SessionContentSearchOverlay enabled={contentSearchEnabled} surface="chat" />
      <DebugProfiler id="chat-composer-dock-region">
        <ChatComposerDock
          ref={dockRef}
          backdrop={isSessionMode}
          outboundSlot={composerDockSlots.outboundSlot}
          activeSlot={composerDockSlots.activeSlot}
          attachedSlot={composerDockSlots.attachedSlot}
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
