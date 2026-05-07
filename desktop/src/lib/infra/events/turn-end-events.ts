export type TurnEndCallback = (sessionId: string, eventType: "turn_ended" | "error") => void;

const turnEndListeners = new Set<TurnEndCallback>();
const userFacingTurnEndListeners = new Set<TurnEndCallback>();

export function onTurnEnd(callback: TurnEndCallback): void {
  turnEndListeners.add(callback);
}

export function offTurnEnd(callback: TurnEndCallback): void {
  turnEndListeners.delete(callback);
}

export function onUserFacingTurnEnd(callback: TurnEndCallback): void {
  userFacingTurnEndListeners.add(callback);
}

export function offUserFacingTurnEnd(callback: TurnEndCallback): void {
  userFacingTurnEndListeners.delete(callback);
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

export function notifyUserFacingTurnEnd(
  sessionId: string,
  eventType: "turn_ended" | "error",
): void {
  for (const listener of userFacingTurnEndListeners) {
    try {
      listener(sessionId, eventType);
    } catch {
      // Listener errors must not break session updates.
    }
  }
}

export function emitTurnEnd(): void {
  notifyUserFacingTurnEnd("__test__", "turn_ended");
}
