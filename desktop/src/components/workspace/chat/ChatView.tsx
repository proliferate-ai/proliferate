import { useCallback, useEffect, useState, type DragEvent, type JSX } from "react";
import { ChatInput } from "@/components/workspace/chat/input/ChatInput";
import { ChatComposerDock } from "@/components/workspace/chat/input/ChatComposerDock";
import { DebugProfiler } from "@/components/ui/DebugProfiler";
import { WorkspaceMobilityFooterRow } from "@/components/workspace/chat/input/WorkspaceMobilityFooterRow";
import { ChatLaunchIntentPane } from "@/components/workspace/chat/surface/ChatLaunchIntentPane";
import { ChatLoadingHero } from "@/components/workspace/chat/surface/ChatLoadingHero";
import { ChatPreMessageCanvas } from "@/components/workspace/chat/surface/ChatPreMessageCanvas";
import { ChatReadyHero } from "@/components/workspace/chat/surface/ChatReadyHero";
import { NoWorkspaceState } from "@/components/workspace/chat/surface/NoWorkspaceState";
import { SessionTranscriptPane } from "@/components/workspace/chat/surface/SessionTranscriptPane";
import { WorkspaceMobilityOverlay } from "@/components/workspace/chat/surface/WorkspaceMobilityOverlay";
import { type ChatSurfaceState, useChatSurfaceState } from "@/hooks/chat/use-chat-surface-state";
import {
  useActiveSessionId,
  useActiveSessionPromptCapabilities,
} from "@/hooks/chat/use-active-chat-session-selectors";
import { useChatAvailabilityState } from "@/hooks/chat/use-chat-availability-state";
import { useChatDockInset } from "@/hooks/chat/use-chat-dock-inset";
import { useChatPromptAttachments } from "@/hooks/chat/use-chat-prompt-attachments";
import { useCloudWorkspacePolling } from "@/hooks/chat/use-cloud-workspace-polling";
import { useComposerDockSlots } from "@/hooks/chat/use-composer-dock-slots";
import { useQueuedPromptEditStatus } from "@/hooks/chat/use-queued-prompt-edit";
import { useDebugRenderCount } from "@/hooks/ui/use-debug-render-count";
import { useDebugValueChange } from "@/hooks/ui/use-debug-value-change";
import { useSessionErrorAcknowledgement } from "@/hooks/sessions/use-session-error-acknowledgement";
import { useSelectedCloudRuntimeRehydration } from "@/hooks/workspaces/use-selected-cloud-runtime-rehydration";
import { useSelectedCloudRuntimeState } from "@/hooks/workspaces/use-selected-cloud-runtime-state";
import { useWorkspaceMobilityLifecycle } from "@/hooks/workspaces/mobility/use-workspace-mobility-lifecycle";
import { canAttachPromptContent } from "@/lib/domain/chat/prompt-content";
import {
  canAcceptChatFileDrop,
  isFileDrag,
  readFileDragInput,
} from "@/lib/domain/chat/prompt-attachment-drag";
import type { WorkspaceRenderSurface } from "@/lib/domain/workspaces/tabs/shell-activation";

function ChatContent({
  dockSafeAreaPx,
  mode,
  scrollBottomInsetPx,
  stickyBottomInsetPx,
}: {
  dockSafeAreaPx: number;
  mode: ChatSurfaceState;
  scrollBottomInsetPx: number;
  stickyBottomInsetPx: number;
}): JSX.Element | null {
  switch (mode.kind) {
    case "no-workspace":
      return <NoWorkspaceState bottomInsetPx={dockSafeAreaPx} />;
    case "launch-intent":
      return <ChatLaunchIntentPane bottomInsetPx={scrollBottomInsetPx} />;
    // workspace-status and session-loading share the same canvas — both
    // render ChatLoadingHero so the loading → resolve handoff plays even
    // when the user enters via the workspace-status path (cloud runtime
    // provisioning, local arrival, structural repo). React preserves the
    // hero instance across the workspace-status → session-loading →
    // session-empty transitions because both arms return the same JSX tree,
    // so the braille sweep keeps animating until the resolve fires. The
    // attached panels above the composer (WorkspaceArrivalAttachedPanel,
    // CloudRuntimeAttachedPanel) layer on top to carry the actionable
    // status detail.
    case "workspace-status":
    case "session-loading":
      return (
        <ChatPreMessageCanvas bottomInsetPx={dockSafeAreaPx}>
          <ChatLoadingHero />
        </ChatPreMessageCanvas>
      );
    case "session-empty":
      return (
        <ChatPreMessageCanvas bottomInsetPx={dockSafeAreaPx}>
          <ChatReadyHero />
        </ChatPreMessageCanvas>
      );
    case "session-transcript":
      return <SessionTranscriptPane bottomInsetPx={stickyBottomInsetPx} />;
  }
}

function shouldShowSessionInputChrome(mode: ChatSurfaceState): boolean {
  switch (mode.kind) {
    case "workspace-status":
    case "session-loading":
    case "session-empty":
    case "session-transcript":
      return true;
    case "no-workspace":
      return false;
    case "launch-intent":
      return true;
  }
}

export function ChatView({
  shellRenderSurface = null,
}: {
  shellRenderSurface?: WorkspaceRenderSurface | null;
}) {
  useDebugRenderCount("chat-surface");
  const { mode } = useChatSurfaceState(shellRenderSurface);
  const suppressSessionChrome = shellRenderSurface?.kind === "chat-shell"
    || shellRenderSurface?.kind === "chat-session-pending";
  const activeSessionId = useActiveSessionId();
  const activePromptCapabilities = useActiveSessionPromptCapabilities();
  const availability = useChatAvailabilityState();
  const queuedPromptEditStatus = useQueuedPromptEditStatus();
  const selectedCloudRuntime = useSelectedCloudRuntimeState();
  const isSessionMode = shouldShowSessionInputChrome(mode);
  const composerDockSlots = useComposerDockSlots({
    suppressSessionSlots: suppressSessionChrome,
  });
  const promptCapabilities = suppressSessionChrome
    ? null
    : activePromptCapabilities;
  const supportsAttachments = canAttachPromptContent(promptCapabilities);
  const canAcceptFileDrop = canAcceptChatFileDrop({
    isEditingQueuedPrompt: queuedPromptEditStatus.isEditing,
    isDisabled: availability.isDisabled,
    areRuntimeControlsDisabled: availability.areRuntimeControlsDisabled,
    hasActiveSession: !suppressSessionChrome && !!activeSessionId,
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

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }

    console.debug("[chat-view] surface mode", {
      kind: mode.kind,
      composerChrome: isSessionMode,
    });
  }, [isSessionMode, mode.kind]);

  return (
    <DebugProfiler id="chat-surface">
      <div
        className="chat-selection-root relative flex h-full min-h-0 flex-1 flex-col select-none overflow-hidden"
        onDragEnter={handleFileDrag}
        onDragOver={handleFileDrag}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
      <div className="flex flex-1 min-h-0 flex-col">
        <ChatContent
          dockSafeAreaPx={dockSafeAreaPx}
          mode={mode}
          scrollBottomInsetPx={scrollBottomInsetPx}
          stickyBottomInsetPx={stickyBottomInsetPx}
        />
      </div>
      {fileDragOver && (
        <div
          className="pointer-events-none absolute inset-2 z-40 rounded-[var(--radius-composer)] border border-dashed border-primary/70 bg-primary/5"
          aria-hidden="true"
        />
      )}
      <WorkspaceMobilityOverlay />
      <ChatComposerDock
        ref={dockRef}
        backdrop={isSessionMode}
        outboundSlot={composerDockSlots.outboundSlot}
        activeSlot={composerDockSlots.activeSlot}
        attachedSlot={composerDockSlots.attachedSlot}
        footerSlot={<WorkspaceMobilityFooterRow />}
        lowerBackdropTopPx={lowerBackdropTopPx}
        shellClassName="pointer-events-none absolute inset-x-0 bottom-0"
        data-telemetry-block
        data-focus-zone="chat"
      >
        <ChatInput
          attachments={promptAttachments}
          suppressActiveSessionState={suppressSessionChrome}
        />
      </ChatComposerDock>
      </div>
    </DebugProfiler>
  );
}
