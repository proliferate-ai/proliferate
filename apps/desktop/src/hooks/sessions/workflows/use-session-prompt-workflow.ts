import { useSessionIntentActions } from "@/hooks/sessions/workflows/use-session-intent-actions";

export function useSessionPromptWorkflow() {
  const { promptSession } = useSessionIntentActions();
  return { promptSession };
}
