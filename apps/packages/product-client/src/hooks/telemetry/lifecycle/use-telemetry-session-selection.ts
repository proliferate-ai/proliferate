import { useEffect, useRef } from "react";
import { useProductTelemetry } from "#product/hooks/telemetry/facade/use-product-telemetry";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

// Owns the active-session correlation tag: every client vendor event raised
// while a session is open carries that session's id, joining the
// one-session-one-story view (server and runtime carry the same tag). An
// empty value clears the tag so events after close never cite a stale
// session. Does not own session selection.
export function useTelemetrySessionSelection() {
  const activeSessionId = useSessionSelectionStore((state) => state.activeSessionId);
  const telemetry = useProductTelemetry();
  // Starts undefined (never a legal store value) so the mount always writes
  // the tag state — including the explicit clear when no session is open.
  const previousSessionIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (previousSessionIdRef.current === activeSessionId) return;
    previousSessionIdRef.current = activeSessionId;
    telemetry.setTag("session_id", activeSessionId ?? "");
  }, [activeSessionId, telemetry]);
}
