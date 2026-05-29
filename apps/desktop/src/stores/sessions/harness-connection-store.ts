import { create } from "zustand";
import { DEFAULT_RUNTIME_URL } from "@/config/runtime";
import type { HarnessConnectionState } from "@/stores/sessions/session-types";

interface HarnessConnectionStoreState {
  runtimeUrl: string;
  connectionState: HarnessConnectionState;
  error: string | null;
  setRuntimeUrl: (runtimeUrl: string) => void;
  setConnectionState: (connectionState: HarnessConnectionState) => void;
  setError: (error: string | null) => void;
  resetConnectionState: () => void;
}

export const useHarnessConnectionStore = create<HarnessConnectionStoreState>((set) => ({
  runtimeUrl: DEFAULT_RUNTIME_URL,
  connectionState: "connecting",
  error: null,
  setRuntimeUrl: (runtimeUrl) => set({ runtimeUrl }),
  setConnectionState: (connectionState) => set({ connectionState }),
  setError: (error) => set({ error }),
  resetConnectionState: () => set({
    runtimeUrl: DEFAULT_RUNTIME_URL,
    connectionState: "connecting",
    error: null,
  }),
}));
