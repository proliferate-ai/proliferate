import { useMemo } from "react";
import { deriveActiveTodoTracker, type ActiveTodoTracker } from "@/lib/domain/chat/active-todo-tracker";
import { useActiveSessionTranscript } from "./use-active-chat-session-selectors";

export function useActiveTodoTracker(): ActiveTodoTracker | null {
  const transcript = useActiveSessionTranscript();

  return useMemo(
    () => (transcript ? deriveActiveTodoTracker(transcript) : null),
    [transcript],
  );
}
