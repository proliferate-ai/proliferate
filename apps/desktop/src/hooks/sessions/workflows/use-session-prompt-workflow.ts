import { useSessionIntentActions } from "#product/hooks/sessions/workflows/use-session-intent-actions";

export function useSessionPromptWorkflow() {
  const { promptSession } = useSessionIntentActions();
  return { promptSession };
}
