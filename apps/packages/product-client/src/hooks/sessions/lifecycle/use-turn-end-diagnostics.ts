import { useEffect } from "react";
import { offTurnEnd, onTurnEnd } from "#product/lib/infra/events/turn-end-events";
import { recordTurnEnded } from "#product/lib/infra/diagnostics/renderer-diagnostic-migrations";

/**
 * One app-lifetime listener on the turn-end bus. Observing turns here — rather
 * than in the stream side-effect planner — keeps the per-envelope hot path free
 * of diagnostics work, and the bus already carries exactly the two outcomes the
 * record needs.
 */
export function useTurnEndDiagnostics(): void {
  useEffect(() => {
    const handler = (sessionId: string, eventType: "turn_ended" | "error") => {
      recordTurnEnded({ sessionId, eventType });
    };

    onTurnEnd(handler);
    return () => {
      offTurnEnd(handler);
    };
  }, []);
}
