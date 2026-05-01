import {
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";

const activeOverlayIds = new Set<number>();
const listeners = new Set<() => void>();
let nextOverlayId = 1;

export function useNativeOverlayRegistration(active: boolean): void {
  const idRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (!active) {
      return;
    }

    const id = idRef.current ?? nextOverlayId++;
    idRef.current = id;
    const wasEmpty = activeOverlayIds.size === 0;
    activeOverlayIds.add(id);
    if (wasEmpty) {
      notifyNativeOverlayListeners();
    }

    return () => {
      const deleted = activeOverlayIds.delete(id);
      if (deleted && activeOverlayIds.size === 0) {
        notifyNativeOverlayListeners();
      }
    };
  }, [active]);
}

export function useNativeOverlayOpen(): boolean {
  return useSyncExternalStore(
    subscribeToNativeOverlayPresence,
    getNativeOverlayOpenSnapshot,
    getNativeOverlayOpenSnapshot,
  );
}

function subscribeToNativeOverlayPresence(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getNativeOverlayOpenSnapshot(): boolean {
  return activeOverlayIds.size > 0;
}

function notifyNativeOverlayListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}
