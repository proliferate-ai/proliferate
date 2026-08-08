import { create } from "zustand";

/**
 * Where the agents pane is pointed (ADR §4 "Agents pane").
 *
 * The pane is ONE global surface that navigates overview → cluster → agent, and
 * it never auto-follows tab focus: only an explicit entry point moves it. That
 * is why the view lives in a store rather than in the pane's own state — the
 * "N working" cap on a session opens that session's cluster from outside the
 * pane, and the panel tab opens the overview.
 *
 * In-memory only. Where the pane is pointed is a glance, not a preference.
 */

export type AgentsPaneView =
  | { kind: "overview" }
  | { kind: "cluster"; sessionId: string }
  | { kind: "agent"; sessionId: string; sessionLinkId: string };

interface AgentsPaneStoreState {
  view: AgentsPaneView;
  openOverview: () => void;
  openCluster: (sessionId: string) => void;
  openAgent: (sessionId: string, sessionLinkId: string) => void;
  /** One step back up the drill; the overview is the floor. */
  back: () => void;
}

const OVERVIEW: AgentsPaneView = { kind: "overview" };

export const useAgentsPaneStore = create<AgentsPaneStoreState>((set) => ({
  view: OVERVIEW,
  openOverview: () => set({ view: OVERVIEW }),
  openCluster: (sessionId) => set({ view: { kind: "cluster", sessionId } }),
  openAgent: (sessionId, sessionLinkId) =>
    set({ view: { kind: "agent", sessionId, sessionLinkId } }),
  back: () =>
    set((state) => ({
      view: state.view.kind === "agent"
        ? { kind: "cluster", sessionId: state.view.sessionId }
        : OVERVIEW,
    })),
}));
