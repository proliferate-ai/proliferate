import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useActiveChatSessionState } from "@/hooks/chat/use-active-chat-session-state";
import { useVisibleTranscript } from "@/hooks/chat/use-visible-transcript";
import { MessageList } from "@/components/workspace/chat/transcript/MessageList";

export function SessionTranscriptPane() {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const {
    activeSessionId,
    sessionViewState,
  } = useActiveChatSessionState();
  const transcript = useVisibleTranscript();

  if (!activeSessionId) {
    return null;
  }

  return (
    <MessageList
      activeSessionId={activeSessionId}
      selectedWorkspaceId={selectedWorkspaceId}
      transcript={transcript}
      sessionViewState={sessionViewState}
    />
  );
}
