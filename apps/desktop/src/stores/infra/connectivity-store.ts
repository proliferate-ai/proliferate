import { create } from "zustand";

interface ConnectivityState {
  /** Whether the renderer currently believes it has network connectivity. */
  isOnline: boolean;
  setOnline: (isOnline: boolean) => void;
}

function initialOnline(): boolean {
  if (typeof navigator === "undefined") {
    return true;
  }
  // navigator.onLine is best-effort (it only reflects link-layer connectivity),
  // but it is the only synchronous signal available and is a good-enough gate
  // for the offline indicator + reconnect pausing.
  return navigator.onLine;
}

export const useConnectivityStore = create<ConnectivityState>((set) => ({
  isOnline: initialOnline(),
  setOnline: (isOnline) =>
    set((state) => (state.isOnline === isOnline ? state : { isOnline })),
}));

/** Vanilla accessor for non-React modules (reconnect scheduler). */
export function isConnectivityOnline(): boolean {
  return useConnectivityStore.getState().isOnline;
}
