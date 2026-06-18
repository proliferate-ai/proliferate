import { useSyncExternalStore } from "react";
import { isSessionSlotBusy } from "@proliferate/product-domain/sessions/activity";
import { activitySnapshotFromDirectoryEntry } from "@/lib/domain/sessions/directory/directory-activity";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";

const DEV_OVERRIDE_KEY = "proliferate.dev.runningAgentCount";
const DEV_OVERRIDE_EVENT = "proliferate:dev-running-agent-count";

function readDevOverride(): number | null {
  if (!import.meta.env.DEV || typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(DEV_OVERRIDE_KEY);
  if (raw === null) {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null;
}

function subscribeDevOverride(onChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  window.addEventListener("storage", onChange);
  window.addEventListener(DEV_OVERRIDE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(DEV_OVERRIDE_EVENT, onChange);
  };
}

// Dev-only: lets the update playground force a running-session count so the session-aware
// restart confirm can be exercised without real sessions. No-op outside dev / in production.
export function setDevRunningAgentCount(count: number | null): void {
  if (!import.meta.env.DEV || typeof window === "undefined") {
    return;
  }
  if (count === null) {
    window.localStorage.removeItem(DEV_OVERRIDE_KEY);
  } else {
    window.localStorage.setItem(DEV_OVERRIDE_KEY, String(Math.max(0, Math.floor(count))));
  }
  window.dispatchEvent(new Event(DEV_OVERRIDE_EVENT));
}

/**
 * Reactive count of local sessions currently doing work — the same "busy" definition
 * the quit guard uses ("N running agents will be paused"). These are the sessions a
 * restart would interrupt, so the update restart confirm reads from here. In dev a
 * playground override can stand in for real sessions.
 */
export function useRunningAgentCount(): number {
  const realCount = useSessionDirectoryStore((state) =>
    Object.values(state.entriesById).filter((entry) =>
      isSessionSlotBusy(activitySnapshotFromDirectoryEntry(entry)),
    ).length,
  );
  const devOverride = useSyncExternalStore(subscribeDevOverride, readDevOverride, () => null);
  return devOverride ?? realCount;
}
