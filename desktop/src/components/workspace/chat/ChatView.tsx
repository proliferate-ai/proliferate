import {
  memo,
  useCallback,
  useMemo,
  useState,
  type DragEvent,
  type JSX,
} from "react";
import { ChatInput } from "@/components/workspace/chat/input/ChatInput";
import { ChatComposerDock } from "@/components/workspace/chat/input/ChatComposerDock";
import { DebugProfiler } from "@/components/ui/DebugProfiler";
import { WorkspaceMobilityFooterRow } from "@/components/workspace/chat/input/WorkspaceMobilityFooterRow";
import { ChatLaunchIntentPane } from "@/components/workspace/chat/surface/ChatLaunchIntentPane";
import { ChatPreMessageCanvas } from "@/components/workspace/chat/surface/ChatPreMessageCanvas";
import { ChatReadyHero } from "@/components/workspace/chat/surface/ChatReadyHero";
import { NoWorkspaceState } from "@/components/workspace/chat/surface/NoWorkspaceState";
import { SessionTranscriptPane } from "@/components/workspace/chat/surface/SessionTranscriptPane";
import { TranscriptSwitchingPlaceholder } from "@/components/workspace/chat/surface/TranscriptSwitchingPlaceholder";
import { WorkspaceMobilityOverlay } from "@/components/workspace/chat/surface/WorkspaceMobilityOverlay";
import { type ChatSurfaceState, useChatSurfaceState } from "@/hooks/chat/derived/use-chat-surface-state";
import {
  useActiveSessionId,
  useActiveSessionPromptCapabilities,
} from "@/hooks/chat/derived/use-active-chat-session-selectors";
import { useChatAvailabilityState } from "@/hooks/chat/derived/use-chat-availability-state";
import { useChatDockInset } from "@/hooks/chat/ui/use-chat-dock-inset";
import { useChatPromptAttachments } from "@/hooks/chat/ui/use-chat-prompt-attachments";
import { useCloudWorkspacePolling } from "@/hooks/chat/use-cloud-workspace-polling";
import { useComposerDockSlots } from "@/hooks/chat/ui/use-composer-dock-slots";
import { useQueuedPromptEditStatus } from "@/hooks/chat/use-queued-prompt-edit";
import { useDebugRenderCount } from "@/hooks/ui/use-debug-render-count";
import { useDebugRenderReason } from "@/hooks/ui/use-debug-render-reason";
import { useDebugValueChange } from "@/hooks/ui/use-debug-value-change";
import { useSessionErrorAcknowledgement } from "@/hooks/sessions/lifecycle/use-session-error-acknowledgement";
import { useSelectedCloudRuntimeRehydration } from "@/hooks/workspaces/lifecycle/use-selected-cloud-runtime-rehydration";
import { useSelectedCloudRuntimeState } from "@/hooks/workspaces/use-selected-cloud-runtime-state";
import { useWorkspaceMobilityLifecycle } from "@/hooks/workspaces/mobility/use-workspace-mobility-lifecycle";
import { canAttachPromptContent } from "@/lib/domain/chat/composer/prompt-attachment-rules";
import {
  canAcceptChatFileDrop,
  isFileDrag,
  readFileDragInput,
} from "@/lib/domain/chat/composer/prompt-attachment-drag";
import type { WorkspaceRenderSurface } from "@/lib/domain/workspaces/tabs/shell-activation";
import { useProliferatePerfFlag } from "@/hooks/ui/use-proliferate-perf-flag";

function ChatContent({
  dockSafeAreaPx,
  freezeTranscriptPane,
  mode,
  scrollBottomInsetPx,
  stickyBottomInsetPx,
}: {
  dockSafeAreaPx: number;
  freezeTranscriptPane: boolean;
  mode: ChatSurfaceState;
  scrollBottomInsetPx: number;
  stickyBottomInsetPx: number;
}): JSX.Element | null {
  switch (mode.kind) {
    case "no-workspace":
      return <NoWorkspaceState bottomInsetPx={dockSafeAreaPx} />;
    case "launch-intent":
      return <ChatLaunchIntentPane bottomInsetPx={scrollBottomInsetPx} />;
    case "workspace-status":
    case "session-loading":
      return (
        <ChatPreMessageCanvas bottomInsetPx={dockSafeAreaPx}>
          <ChatReadyHero />
        </ChatPreMessageCanvas>
      );
    case "session-hydrating":
      return freezeTranscriptPane
        ? <PerfFrozenChatSurface label="Transcript pane frozen" />
        : <SessionTranscriptPane bottomInsetPx={stickyBottomInsetPx} />;
    case "session-switching":
      return <TranscriptSwitchingPlaceholder />;
    case "session-empty":
      return (
        <ChatPreMessageCanvas bottomInsetPx={dockSafeAreaPx}>
          <ChatReadyHero />
        </ChatPreMessageCanvas>
      );
    case "session-transcript":
      return freezeTranscriptPane
        ? <PerfFrozenChatSurface label="Transcript pane frozen" />
        : <SessionTranscriptPane bottomInsetPx={stickyBottomInsetPx} />;
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

export const ChatView = memo(function ChatView({
  shellRenderSurface = null,
}: {
  shellRenderSurface?: WorkspaceRenderSurface | null;
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
  const freezeComposerDock = useProliferatePerfFlag("freezeComposerDock");
  const freezeTranscriptPane = useProliferatePerfFlag("freezeTranscriptPane");
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
  const promptAttachments = useChatPromptAttachments({
    activeSessionId,
    promptCapabilities,
    canAttachFiles: canAcceptFileDrop,
  });
  const [fileDragOver, setFileDragOver] = useState(false);
  const {
    dockRef,
    dockSafeAreaPx,
    lowerBackdropTopPx,
    scrollBottomInsetPx,
    stickyBottomInsetPx,
  } = useChatDockInset();

  useCloudWorkspacePolling();
  useSelectedCloudRuntimeRehydration(selectedCloudRuntime);
  useSessionErrorAcknowledgement();
  useWorkspaceMobilityLifecycle();

  const chatInput = useMemo(() => (
    <ChatInput
      attachments={promptAttachments}
      suppressActiveSessionState={suppressComposerActiveSessionState}
    />
  ), [promptAttachments, suppressComposerActiveSessionState]);
  const footerSlot = useMemo(() => <WorkspaceMobilityFooterRow />, []);

  useDebugValueChange("chat_surface.inputs", "chat_view_refs", {
    modeKind: mode.kind,
    activeSessionId,
    activePromptCapabilities,
    availability,
    queuedPromptEditStatus,
    selectedCloudRuntimeState: selectedCloudRuntime.state,
    composerDockSlots,
    promptAttachments,
    canAcceptFileDrop,
    dockSafeAreaPx,
    lowerBackdropTopPx,
    scrollBottomInsetPx,
    stickyBottomInsetPx,
  });
  useDebugRenderReason("ChatView", {
    shellRenderSurface,
    mode,
    suppressSessionSlots,
    suppressComposerActiveSessionState,
    activeSessionId,
    activePromptCapabilities,
    availability,
    queuedPromptEditStatus,
    selectedCloudRuntimeState: selectedCloudRuntime.state,
    isSessionMode,
    composerDockSlots,
    promptCapabilities,
    supportsAttachments,
    canAcceptFileDrop,
    promptAttachments,
    fileDragOver,
    dockSafeAreaPx,
    lowerBackdropTopPx,
    scrollBottomInsetPx,
    stickyBottomInsetPx,
  });

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

  return (
    <DebugProfiler id="chat-surface">
      <div
        className="chat-selection-root relative flex h-full min-h-0 flex-1 flex-col select-none overflow-hidden"
        onDragEnter={handleFileDrag}
        onDragOver={handleFileDrag}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
      <DebugProfiler id="chat-content">
        <div className="flex flex-1 min-h-0 flex-col">
          <ChatContent
            dockSafeAreaPx={dockSafeAreaPx}
            freezeTranscriptPane={freezeTranscriptPane}
            mode={mode}
            scrollBottomInsetPx={scrollBottomInsetPx}
            stickyBottomInsetPx={stickyBottomInsetPx}
          />
        </div>
      </DebugProfiler>
      {fileDragOver && (
        <div
          className="pointer-events-none absolute inset-2 z-40 rounded-[var(--radius-composer)] border border-dashed border-primary/70 bg-primary/5"
          aria-hidden="true"
        />
      )}
      <WorkspaceMobilityOverlay />
      {freezeComposerDock ? (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-6 pb-4"
          data-perf-frozen="composer-dock"
        >
          <div className="mx-auto max-w-3xl rounded-md border border-dashed border-border/70 bg-background/90 px-3 py-2 text-xs text-muted-foreground">
            Composer dock frozen
          </div>
        </div>
      ) : (
        <DebugProfiler id="chat-composer-dock-region">
          <ChatComposerDock
            ref={dockRef}
            backdrop={isSessionMode}
            outboundSlot={composerDockSlots.outboundSlot}
            activeSlot={composerDockSlots.activeSlot}
            attachedSlot={composerDockSlots.attachedSlot}
            footerSlot={footerSlot}
            lowerBackdropTopPx={lowerBackdropTopPx}
            shellClassName="pointer-events-none absolute inset-x-0 bottom-0"
            data-telemetry-block
            data-focus-zone="chat"
          >
            {chatInput}
          </ChatComposerDock>
        </DebugProfiler>
      )}
      </div>
    </DebugProfiler>
  );
});

function PerfFrozenChatSurface({ label }: { label: string }) {
  return (
    <div
      className="flex h-full min-h-0 w-full items-center justify-center border border-dashed border-border/70 bg-muted/20 p-3 text-xs text-muted-foreground"
      data-perf-frozen="transcript-pane"
    >
      {label}
    </div>
  );
}
