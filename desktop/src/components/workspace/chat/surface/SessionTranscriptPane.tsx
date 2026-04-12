import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useActiveChatSessionState } from "@/hooks/chat/use-active-chat-session-state";
import { MessageList } from "@/components/workspace/chat/transcript/MessageList";

export function SessionTranscriptPane() {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
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
    <MessageList
      activeSessionId={activeSessionId}
      selectedWorkspaceId={selectedWorkspaceId}
      optimisticPrompt={optimisticPrompt}
      transcript={transcript}
      sessionViewState={sessionViewState}
    />
  );
}
