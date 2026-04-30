import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useActiveChatSessionState } from "@/hooks/chat/use-active-chat-session-state";
import { MessageList } from "@/components/workspace/chat/transcript/MessageList";
import { ConnectedPlanHandoffDialog } from "@/components/workspace/chat/plans/ConnectedPlanHandoffDialog";
import { usePlanHandoffDialogState } from "@/hooks/plans/use-plan-handoff-dialog-state";

export function SessionTranscriptPane() {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const handoff = usePlanHandoffDialogState();
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
    <>
      <MessageList
        activeSessionId={activeSessionId}
        selectedWorkspaceId={selectedWorkspaceId}
        optimisticPrompt={optimisticPrompt}
        transcript={transcript}
        sessionViewState={sessionViewState}
        onHandOffPlanToNewSession={handoff.open}
      />
      {handoff.plan && (
        <ConnectedPlanHandoffDialog
          plan={handoff.plan}
          onClose={handoff.close}
        />
      )}
    </>
  );
}
