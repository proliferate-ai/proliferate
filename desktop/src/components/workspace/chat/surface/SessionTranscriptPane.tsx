import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useActiveChatSessionState } from "@/hooks/chat/use-active-chat-session-state";
import { MessageList } from "@/components/workspace/chat/transcript/MessageList";

export function SessionTranscriptPane() {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const {
    activeSessionId,
    transcript,
    pendingUserPrompt,
    sessionViewState,
  } = useActiveChatSessionState();

  if (!activeSessionId) {
    return null;
  }

  return (
    <MessageList
      activeSessionId={activeSessionId}
      selectedWorkspaceId={selectedWorkspaceId}
      transcript={transcript}
      pendingUserPrompt={pendingUserPrompt}
      sessionViewState={sessionViewState}
    />
  );
}
