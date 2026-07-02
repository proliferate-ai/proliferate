import { create } from "zustand";
import {
  DETACHED_DIRECT_RUNTIME_CONNECTION,
  directRuntimeConnectionKey,
  loopbackDirectRuntimeConnectionState,
  reduceDirectRuntimeConnection,
  type DirectRuntimeConnectionEvent,
  type DirectRuntimeConnectionSnapshot,
} from "@/lib/domain/compute/direct-runtime";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";

interface DirectRuntimeConnectionStoreState {
  connectionsByKey: Record<string, DirectRuntimeConnectionSnapshot>;
  dispatchConnectionEvent: (
    targetId: string | null,
    event: DirectRuntimeConnectionEvent,
  ) => void;
  resetConnections: () => void;
}

export const useDirectRuntimeConnectionStore = create<DirectRuntimeConnectionStoreState>(
  (set) => ({
    connectionsByKey: {},
    dispatchConnectionEvent: (targetId, event) => {
      // Loopback state derives from the harness bootstrap; only remote
      // direct runtimes carry an attach machine of their own.
      if (targetId === null) {
        return;
      }
      const key = directRuntimeConnectionKey(targetId);
      set((state) => ({
        connectionsByKey: {
          ...state.connectionsByKey,
          [key]: reduceDirectRuntimeConnection(
            state.connectionsByKey[key] ?? DETACHED_DIRECT_RUNTIME_CONNECTION,
            event,
          ),
        },
      }));
    },
    resetConnections: () => set({ connectionsByKey: {} }),
  }),
);

export function getDirectRuntimeConnectionSnapshot(
  targetId: string | null,
): DirectRuntimeConnectionSnapshot {
  if (targetId === null) {
    const { runtimeUrl, connectionState, error } = useHarnessConnectionStore.getState();
    const derived = loopbackDirectRuntimeConnectionState(connectionState);
    return {
      connectionState: derived,
      baseUrl: derived === "attached" ? runtimeUrl : null,
      authToken: null,
      lastError: error,
    };
  }
  const key = directRuntimeConnectionKey(targetId);
  return (
    useDirectRuntimeConnectionStore.getState().connectionsByKey[key]
    ?? DETACHED_DIRECT_RUNTIME_CONNECTION
  );
}
