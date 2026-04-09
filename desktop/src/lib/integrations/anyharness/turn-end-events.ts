export type TurnEndCallback = (sessionId: string, eventType: "turn_ended" | "error") => void;

const turnEndListeners = new Set<TurnEndCallback>();

export function onTurnEnd(callback: TurnEndCallback): void {
  turnEndListeners.add(callback);
}

export function offTurnEnd(callback: TurnEndCallback): void {
  turnEndListeners.delete(callback);
}

export function notifyTurnEnd(
  sessionId: string,
  eventType: "turn_ended" | "error",
): void {
  for (const listener of turnEndListeners) {
    try {
      listener(sessionId, eventType);
    } catch {
      // Listener errors must not break session updates.
    }
  }
}

export function emitTurnEnd(): void {
  notifyTurnEnd("__test__", "turn_ended");
}
