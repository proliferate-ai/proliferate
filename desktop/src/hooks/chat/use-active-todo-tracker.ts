import { useMemo } from "react";
import { deriveActiveTodoTracker, type ActiveTodoTracker } from "@/lib/domain/chat/active-todo-tracker";
import { useHarnessStore } from "@/stores/sessions/harness-store";

export function useActiveTodoTracker(): ActiveTodoTracker | null {
  const activeSlot = useHarnessStore((state) =>
    state.activeSessionId ? state.sessionSlots[state.activeSessionId] ?? null : null,
  );
  const transcript = activeSlot?.transcript ?? null;

  return useMemo(
    () => (transcript ? deriveActiveTodoTracker(transcript) : null),
    [transcript],
  );
}
