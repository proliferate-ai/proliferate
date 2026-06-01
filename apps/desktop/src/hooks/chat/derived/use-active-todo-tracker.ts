import { useMemo } from "react";
import { deriveActiveTodoTracker, type ActiveTodoTracker } from "@proliferate/product-domain/chats/tools/active-todo-tracker";
import { useActiveSessionTranscript } from "./use-active-session-transcript-state";

export function useActiveTodoTracker(): ActiveTodoTracker | null {
  const transcript = useActiveSessionTranscript();

  return useMemo(
    () => (transcript ? deriveActiveTodoTracker(transcript) : null),
    [transcript],
  );
}
