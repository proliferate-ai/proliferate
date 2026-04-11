import { useCallback, useEffect, useRef } from "react";
import { useConnectorSyncRetry } from "./use-connector-sync-retry";

const RETRY_DELAYS_MS = [60_000, 300_000, 900_000] as const;
const HOURLY_RETRY_MS = 3_600_000;

export function useConnectorSyncRetryDaemon() {
  const { retryPendingConnectorSync } = useConnectorSyncRetry();
  const inFlightRef = useRef(false);
  const retryPendingConnectorSyncRef = useRef(retryPendingConnectorSync.mutateAsync);

  useEffect(() => {
    retryPendingConnectorSyncRef.current = retryPendingConnectorSync.mutateAsync;
  }, [retryPendingConnectorSync.mutateAsync]);

  const runRetry = useCallback(async () => {
    if (inFlightRef.current) {
      return;
    }
    inFlightRef.current = true;
    try {
      await retryPendingConnectorSyncRef.current({ silent: true });
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    void runRetry();

    // Retry quickly after startup/network recovery, then fall back to an hourly sweep
    // for degraded connector replicas that still need cloud reconciliation.
    const timeoutIds = RETRY_DELAYS_MS.map((delay) => window.setTimeout(() => {
      void runRetry();
    }, delay));
    const intervalId = window.setInterval(() => {
      void runRetry();
    }, HOURLY_RETRY_MS);
    const handleOnline = () => {
      void runRetry();
    };

    window.addEventListener("online", handleOnline);
    return () => {
      for (const timeoutId of timeoutIds) {
        window.clearTimeout(timeoutId);
      }
      window.clearInterval(intervalId);
      window.removeEventListener("online", handleOnline);
    };
  }, [runRetry]);
}
