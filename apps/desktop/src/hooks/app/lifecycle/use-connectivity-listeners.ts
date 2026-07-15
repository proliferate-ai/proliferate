import { useEffect } from "react";
import { useConnectivityStore } from "@/stores/infra/connectivity-store";
import { flushOfflineSessionReconnects } from "@/lib/workflows/sessions/session-reconnect-state";

/**
 * Wires up window online/offline listeners to the connectivity store.
 * Also triggers pending session reconnects when the app comes back online.
 * Must be mounted once at the app root.
 */
export function useConnectivityListeners(): void {
  useEffect(() => {
    const setOnline = useConnectivityStore.getState().setOnline;

    const handleOnline = () => {
      setOnline(true);
      // Immediately fire any parked reconnect runners.
      flushOfflineSessionReconnects();
    };
    const handleOffline = () => {
      setOnline(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);
}
