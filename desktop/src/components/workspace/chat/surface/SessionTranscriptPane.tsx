import { useHarnessStore } from "@/stores/sessions/harness-store";
import { DebugProfiler } from "@/components/ui/DebugProfiler";
import { useActiveChatSessionState } from "@/hooks/chat/use-active-chat-session-state";
import { useDebugRenderCount } from "@/hooks/ui/use-debug-render-count";
import { MessageList } from "@/components/workspace/chat/transcript/MessageList";
import { ConnectedPlanHandoffDialog } from "@/components/workspace/chat/plans/ConnectedPlanHandoffDialog";
import { usePlanHandoffDialogState } from "@/hooks/plans/use-plan-handoff-dialog-state";
import { useSessionSelectionActions } from "@/hooks/sessions/use-session-selection-actions";

interface SessionTranscriptPaneProps {
  bottomInsetPx: number;
}

export function SessionTranscriptPane({ bottomInsetPx }: SessionTranscriptPaneProps) {
  useDebugRenderCount("session-transcript-pane");
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const handoff = usePlanHandoffDialogState();
  const { selectSession } = useSessionSelectionActions();
  const {
    activeSessionId,
    optimisticPrompt,
    transcript,
    sessionViewState,
  } = useActiveChatSessionState();

  if (!activeSessionId) {
    return null;
  }

  return (
    <DebugProfiler id="session-transcript-pane">
      <MessageList
        activeSessionId={activeSessionId}
        selectedWorkspaceId={selectedWorkspaceId}
        optimisticPrompt={optimisticPrompt}
        transcript={transcript}
        sessionViewState={sessionViewState}
        bottomInsetPx={bottomInsetPx}
        onHandOffPlanToNewSession={handoff.open}
        onOpenSession={(sessionId) => void selectSession(sessionId)}
      />
      {handoff.plan && (
        <ConnectedPlanHandoffDialog
          plan={handoff.plan}
          onClose={handoff.close}
        />
      )}
    </DebugProfiler>
  );
}
