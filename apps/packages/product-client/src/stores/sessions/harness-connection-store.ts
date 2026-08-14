import { create } from "zustand";
import type { HarnessConnectionState } from "#product/stores/sessions/session-types";

/**
 * Where the current `runtimeUrl` came from. `native_capture` means the native
 * runtime bridge reported it; `default_fallback` means bootstrap could not
 * reach the bridge and seeded the dev default. Consented support snapshots
 * refuse an untrusted (fallback) runtime, so the provenance has to travel with
 * the URL rather than be guessed from its shape.
 */
export type HarnessRuntimeUrlSource = "native_capture" | "default_fallback";

interface HarnessConnectionStoreState {
  runtimeUrl: string;
  runtimeUrlSource: HarnessRuntimeUrlSource;
  connectionState: HarnessConnectionState;
  error: string | null;
  setRuntimeUrl: (runtimeUrl: string) => void;
  setConnectionState: (connectionState: HarnessConnectionState) => void;
  setError: (error: string | null) => void;
  resetConnectionState: () => void;
}

export const useHarnessConnectionStore = create<HarnessConnectionStoreState>((set) => ({
  runtimeUrl: "",
  // Fail closed: nothing is a natively captured runtime until bootstrap proves
  // it through the Desktop runtime bridge.
  runtimeUrlSource: "default_fallback",
  connectionState: "connecting",
  error: null,
  setRuntimeUrl: (runtimeUrl) => set({ runtimeUrl }),
  setConnectionState: (connectionState) => set({ connectionState }),
  setError: (error) => set({ error }),
  resetConnectionState: () => set({
    runtimeUrl: "",
    runtimeUrlSource: "default_fallback",
    connectionState: "connecting",
    error: null,
  }),
}));
