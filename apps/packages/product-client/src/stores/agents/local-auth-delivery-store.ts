import { create } from "zustand";

/**
 * The last local agent-auth state push failure, as the runtime refused it.
 *
 * `code` is the runtime's stable problem code (e.g.
 * `AGENT_ROUTE_STATE_LINEAGE`); `detail` is its plain-words refusal copy,
 * carried verbatim so the pane can show exactly what the runtime said.
 */
export interface LocalAuthPushFailure {
  code: string | null;
  detail: string | null;
}

interface LocalAuthDeliveryStoreState {
  /**
   * Set by the courier (`use-local-auth-state-sync.ts`) when a state push to
   * the local runtime fails, cleared when one succeeds. This is the one
   * channel through which a typed runtime refusal — notably the
   * foreign-lineage 409, whose only recovery is an explicit user action —
   * reaches the settings pane; a courier retry alone can never clear it,
   * because the runtime keeps refusing the same document.
   */
  lastPushFailure: LocalAuthPushFailure | null;
  setLastPushFailure: (failure: LocalAuthPushFailure) => void;
  clearLastPushFailure: () => void;
}

export const useLocalAuthDeliveryStore = create<LocalAuthDeliveryStoreState>((set) => ({
  lastPushFailure: null,
  setLastPushFailure: (failure) => set({ lastPushFailure: failure }),
  clearLastPushFailure: () => set({ lastPushFailure: null }),
}));
