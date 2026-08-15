import { create } from "zustand";

/**
 * Per-workspace navigation state for the agents pane.
 *
 * Each workspace carries its own route independently: the roster overview, a
 * cluster drilled into one parent durable session, or a detail view on one
 * child of that parent. Routes are identified purely by durable session IDs —
 * opening a route never reads or changes the workspace's active main session.
 */

export type AgentsPaneRoute =
  | { kind: "overview" }
  | { kind: "cluster"; parentDurableId: string }
  | { kind: "detail"; parentDurableId: string; childDurableId: string };

const OVERVIEW: AgentsPaneRoute = { kind: "overview" };

interface AgentsPaneNavigationState {
  routesByWorkspaceId: Record<string, AgentsPaneRoute>;
  openOverview: (workspaceId: string) => void;
  openCluster: (workspaceId: string, parentDurableId: string) => void;
  openDetail: (
    workspaceId: string,
    parentDurableId: string,
    childDurableId: string,
  ) => void;
  /** detail -> its cluster; cluster -> overview; overview stays put. */
  back: (workspaceId: string) => void;
  /** Drops the workspace's entry entirely (falls back to overview on read). */
  reset: (workspaceId: string) => void;
  /**
   * Repairs a route whose targets disappeared externally: detail falls to its
   * cluster when only the child vanished, and any route referencing a missing
   * parent falls to overview. Pure with respect to the live-ID snapshots
   * passed in; a no-op when the route is still valid.
   */
  repair: (
    workspaceId: string,
    liveParentDurableIds: ReadonlySet<string>,
    liveChildDurableIdsByParent: ReadonlyMap<string, ReadonlySet<string>>,
  ) => void;
}

function routeFor(
  routesByWorkspaceId: Record<string, AgentsPaneRoute>,
  workspaceId: string,
): AgentsPaneRoute {
  return routesByWorkspaceId[workspaceId] ?? OVERVIEW;
}

/**
 * Pure repair rule, exported for direct testing: returns the route the pane
 * should fall back to given which durable sessions still exist.
 */
export function repairAgentsPaneRoute(
  route: AgentsPaneRoute,
  liveParentDurableIds: ReadonlySet<string>,
  liveChildDurableIdsByParent: ReadonlyMap<string, ReadonlySet<string>>,
): AgentsPaneRoute {
  if (route.kind === "overview") {
    return route;
  }
  if (!liveParentDurableIds.has(route.parentDurableId)) {
    return OVERVIEW;
  }
  if (route.kind === "detail") {
    const children = liveChildDurableIdsByParent.get(route.parentDurableId);
    if (!children?.has(route.childDurableId)) {
      return { kind: "cluster", parentDurableId: route.parentDurableId };
    }
  }
  return route;
}

export const useAgentsPaneNavigationStore = create<AgentsPaneNavigationState>(
  (set) => {
    const setRoute = (workspaceId: string, route: AgentsPaneRoute) =>
      set((state) => ({
        routesByWorkspaceId: {
          ...state.routesByWorkspaceId,
          [workspaceId]: route,
        },
      }));
    return {
      routesByWorkspaceId: {},
      openOverview: (workspaceId) => setRoute(workspaceId, OVERVIEW),
      openCluster: (workspaceId, parentDurableId) =>
        setRoute(workspaceId, { kind: "cluster", parentDurableId }),
      openDetail: (workspaceId, parentDurableId, childDurableId) =>
        setRoute(workspaceId, {
          kind: "detail",
          parentDurableId,
          childDurableId,
        }),
      back: (workspaceId) =>
        set((state) => {
          const route = routeFor(state.routesByWorkspaceId, workspaceId);
          if (route.kind === "overview") {
            return state;
          }
          const next: AgentsPaneRoute =
            route.kind === "detail"
              ? { kind: "cluster", parentDurableId: route.parentDurableId }
              : OVERVIEW;
          return {
            routesByWorkspaceId: {
              ...state.routesByWorkspaceId,
              [workspaceId]: next,
            },
          };
        }),
      reset: (workspaceId) =>
        set((state) => {
          if (!(workspaceId in state.routesByWorkspaceId)) {
            return state;
          }
          const routesByWorkspaceId = { ...state.routesByWorkspaceId };
          delete routesByWorkspaceId[workspaceId];
          return { routesByWorkspaceId };
        }),
      repair: (workspaceId, liveParentDurableIds, liveChildDurableIdsByParent) =>
        set((state) => {
          const route = routeFor(state.routesByWorkspaceId, workspaceId);
          const repaired = repairAgentsPaneRoute(
            route,
            liveParentDurableIds,
            liveChildDurableIdsByParent,
          );
          if (repaired === route) {
            return state;
          }
          return {
            routesByWorkspaceId: {
              ...state.routesByWorkspaceId,
              [workspaceId]: repaired,
            },
          };
        }),
    };
  },
);

/** Selector: the workspace's current route, defaulting to overview. */
export function selectAgentsPaneRoute(
  state: Pick<AgentsPaneNavigationState, "routesByWorkspaceId">,
  workspaceId: string,
): AgentsPaneRoute {
  return routeFor(state.routesByWorkspaceId, workspaceId);
}
