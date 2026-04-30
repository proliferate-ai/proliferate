import { useEffect, type JSX } from "react";
import { ChatInput } from "@/components/workspace/chat/input/ChatInput";
import { ChatComposerDock } from "@/components/workspace/chat/input/ChatComposerDock";
import { WorkspaceMobilityFooterRow } from "@/components/workspace/chat/input/WorkspaceMobilityFooterRow";
import { ChatLaunchIntentPane } from "@/components/workspace/chat/surface/ChatLaunchIntentPane";
import { ChatLoadingHero } from "@/components/workspace/chat/surface/ChatLoadingHero";
import { ChatPreMessageCanvas } from "@/components/workspace/chat/surface/ChatPreMessageCanvas";
import { ChatReadyHero } from "@/components/workspace/chat/surface/ChatReadyHero";
import { NoWorkspaceState } from "@/components/workspace/chat/surface/NoWorkspaceState";
import { SessionTranscriptPane } from "@/components/workspace/chat/surface/SessionTranscriptPane";
import { WorkspaceMobilityOverlay } from "@/components/workspace/chat/surface/WorkspaceMobilityOverlay";
import { type ChatSurfaceState, useChatSurfaceState } from "@/hooks/chat/use-chat-surface-state";
import { useChatSelectionBoundary } from "@/hooks/chat/use-chat-selection-boundary";
import { useCloudWorkspacePolling } from "@/hooks/chat/use-cloud-workspace-polling";
import { useComposerDockSlots } from "@/hooks/chat/use-composer-dock-slots";
import { useSessionErrorAcknowledgement } from "@/hooks/sessions/use-session-error-acknowledgement";
import { useSelectedCloudRuntimeRehydration } from "@/hooks/workspaces/use-selected-cloud-runtime-rehydration";
import { useSelectedCloudRuntimeState } from "@/hooks/workspaces/use-selected-cloud-runtime-state";
import { useWorkspaceMobilityLifecycle } from "@/hooks/workspaces/mobility/use-workspace-mobility-lifecycle";

function ChatContent({ mode }: { mode: ChatSurfaceState }): JSX.Element | null {
  switch (mode.kind) {
    case "no-workspace":
      return <NoWorkspaceState />;
    case "launch-intent":
      return <ChatLaunchIntentPane />;
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
        <ChatPreMessageCanvas>
          <ChatLoadingHero />
        </ChatPreMessageCanvas>
      );
    case "session-empty":
      return (
        <ChatPreMessageCanvas>
          <ChatReadyHero />
        </ChatPreMessageCanvas>
      );
    case "session-transcript":
      return <SessionTranscriptPane />;
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

export function ChatView() {
  const { mode } = useChatSurfaceState();
  const selectedCloudRuntime = useSelectedCloudRuntimeState();
  const isSessionMode = shouldShowSessionInputChrome(mode);
  const composerDockSlots = useComposerDockSlots();

  useCloudWorkspacePolling();
  useSelectedCloudRuntimeRehydration(selectedCloudRuntime);
  useChatSelectionBoundary();
  useSessionErrorAcknowledgement();
  useWorkspaceMobilityLifecycle();

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
    <div className="chat-selection-root relative flex h-full min-h-0 flex-1 flex-col select-none overflow-hidden">
      <div className="flex flex-1 min-h-0 flex-col">
        <ChatContent mode={mode} />
      </div>
      <WorkspaceMobilityOverlay />
      <ChatComposerDock
        backdrop={isSessionMode}
        contextSlot={composerDockSlots.contextSlot}
        queueSlot={composerDockSlots.queueSlot}
        interactionSlot={composerDockSlots.interactionSlot}
        delegationSlot={composerDockSlots.delegationSlot}
        footerSlot={<WorkspaceMobilityFooterRow />}
        data-telemetry-block
        data-focus-zone="chat"
      >
        <ChatInput />
      </ChatComposerDock>
    </div>
  );
}
