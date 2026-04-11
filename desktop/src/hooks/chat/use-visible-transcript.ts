import { useMemo } from "react";
import type { TranscriptState } from "@anyharness/sdk";
import { useActiveChatSessionState } from "@/hooks/chat/use-active-chat-session-state";
import { projectCoworkTranscript } from "@/lib/domain/chat/cowork-transcript-projection";
import { useSelectedWorkspace } from "@/hooks/workspaces/use-selected-workspace";

export function useVisibleTranscript(): TranscriptState {
  const { transcript } = useActiveChatSessionState();
  const { isCoworkWorkspaceSelected } = useSelectedWorkspace();

  return useMemo(() => {
    if (!isCoworkWorkspaceSelected) {
      return transcript;
    }

    return projectCoworkTranscript(transcript);
  }, [isCoworkWorkspaceSelected, transcript]);
}
