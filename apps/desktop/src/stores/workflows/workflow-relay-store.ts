import { create } from "zustand";

/**
 * Registry of local workflow runs the desktop is relaying (spec 3.2 desktop lane).
 *
 * A run is registered right after the desktop delivers its plan to the local
 * runtime; the top-level relay provider polls each registered run and forwards
 * observed transitions to the server, deregistering on a terminal state. State
 * lives only while the app is open (a known v1 gap) — the provider re-attaches
 * non-terminal local runs on mount so an app restart re-arms the relay.
 */

export interface RelayRunRegistration {
  workspaceId: string;
  runtimeUrl: string;
}

interface WorkflowRelayStoreState {
  runs: Record<string, RelayRunRegistration>;
  register: (runId: string, registration: RelayRunRegistration) => void;
  unregister: (runId: string) => void;
}

export const useWorkflowRelayStore = create<WorkflowRelayStoreState>((set) => ({
  runs: {},
  register: (runId, registration) =>
    set((state) =>
      state.runs[runId]?.workspaceId === registration.workspaceId
        && state.runs[runId]?.runtimeUrl === registration.runtimeUrl
        ? state
        : { runs: { ...state.runs, [runId]: registration } },
    ),
  unregister: (runId) =>
    set((state) => {
      if (!(runId in state.runs)) {
        return state;
      }
      const next = { ...state.runs };
      delete next[runId];
      return { runs: next };
    }),
}));
