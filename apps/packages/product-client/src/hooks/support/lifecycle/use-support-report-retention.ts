import { useEffect } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";

import { useProductTelemetry } from "#product/hooks/telemetry/facade/use-product-telemetry";
import { sweepSupportReportRetention } from "./support-report-retention";

/**
 * One auth-independent retention sweep per launch.
 *
 * `SupportReportQueueRoot` -- the owner that drains the queue and reconciles
 * staged bytes -- is mounted only while authenticated, because both ends of a
 * drain need a Cloud session. Retention does not: a user who signs out or
 * abandons the account is exactly the case where nothing else will ever run,
 * and their queue document and staged report bytes would otherwise sit on the
 * machine forever. So this hook mounts unconditionally, above the auth gate,
 * and reaps on its own.
 *
 * It never drains and never uploads, so it needs no session. A failed sweep is
 * reported and dropped: retention is best-effort cleanup and must never block
 * or break a launch.
 */
export function useSupportReportRetentionLifecycle(): void {
  const host = useProductHost();
  const storage = host.storage;
  const supportSnapshot = host.desktop?.diagnostics?.supportSnapshot ?? null;
  const { captureException } = useProductTelemetry();

  useEffect(() => {
    let cancelled = false;
    void sweepSupportReportRetention({
      storage,
      supportSnapshot,
      now: Date.now(),
      isStale: () => cancelled,
    }).catch((error: unknown) => {
      if (cancelled) return;
      captureException(error);
    });
    return () => {
      cancelled = true;
    };
  }, [storage, supportSnapshot, captureException]);
}
