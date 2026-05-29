import { useSessionIntentActions } from "@/hooks/sessions/workflows/use-session-intent-actions";

export function useSessionConfigActions() {
  const { setActiveSessionConfigOption } = useSessionIntentActions();
  return { setActiveSessionConfigOption };
}
