import { create } from "zustand";

export type DeferredHomeLaunchStatus = "pending" | "consuming";

export interface DeferredHomeLaunch {
  id: string;
  status: DeferredHomeLaunchStatus;
  workspaceId: string;
  cloudWorkspaceId: string;
  cloudAttemptId: string;
  agentKind: string;
  modelId: string;
  modeId: string | null;
  promptText: string;
  promptId: string;
  launchIntentId: string;
  createdAt: number;
}

interface DeferredHomeLaunchState {
  launches: Record<string, DeferredHomeLaunch>;
  enqueue: (launch: DeferredHomeLaunch) => void;
  markConsuming: (id: string) => boolean;
  markPending: (id: string) => void;
  clear: (id: string) => void;
  clearForWorkspace: (workspaceId: string) => void;
}

export function buildDeferredHomeLaunchId(input: {
  cloudWorkspaceId: string;
  attemptId: string;
}): string {
  return `${input.cloudWorkspaceId}:${input.attemptId}`;
}

export const useDeferredHomeLaunchStore = create<DeferredHomeLaunchState>((set) => ({
  launches: {},

  enqueue: (launch) => set((state) => ({
    launches: {
      ...state.launches,
      [launch.id]: launch,
    },
  })),

  markConsuming: (id) => {
    let didMark = false;
    set((state) => {
      const launch = state.launches[id];
      if (!launch || launch.status !== "pending") {
        return state;
      }
      didMark = true;
      return {
        launches: {
          ...state.launches,
          [id]: {
            ...launch,
            status: "consuming",
          },
        },
      };
    });
    return didMark;
  },

  markPending: (id) => set((state) => {
    const launch = state.launches[id];
    if (!launch) {
      return state;
    }
    return {
      launches: {
        ...state.launches,
        [id]: {
          ...launch,
          status: "pending",
        },
      },
    };
  }),

  clear: (id) => set((state) => {
    if (!state.launches[id]) {
      return state;
    }
    const { [id]: _removed, ...launches } = state.launches;
    return { launches };
  }),

  clearForWorkspace: (workspaceId) => set((state) => {
    let changed = false;
    const launches = Object.fromEntries(
      Object.entries(state.launches).filter(([, launch]) => {
        const keep = launch.workspaceId !== workspaceId;
        if (!keep) {
          changed = true;
        }
        return keep;
      }),
    );
    return changed ? { launches } : state;
  }),
}));
