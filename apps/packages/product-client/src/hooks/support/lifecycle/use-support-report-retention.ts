import { useEffect } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import type { ProductStorage } from "@proliferate/product-client/host/product-host";

import { useProductTelemetry } from "#product/hooks/telemetry/facade/use-product-telemetry";

/**
 * Inlined copies of the queue's own storage keys:
 * `SUPPORT_QUEUE_PRIMARY_KEY`/`SUPPORT_QUEUE_PENDING_KEY`
 * (support-report-queue-storage.ts) and `SUPPORT_QUEUE_LEGACY_KEY`
 * (support-report-queue-migration.ts). Deliberately not imported -- either
 * import would pull the whole queue document/storage/migration/canonical
 * module graph into this hook's chunk, which is mounted unconditionally in
 * the public auth shell (`ProductLifecycleRoot`, above the auth gate) and so
 * ships with the login bundle. A pinning test in
 * use-support-report-retention.test.ts asserts these three literals stay
 * equal to the canonical exported constants.
 */
export const SUPPORT_QUEUE_PRIMARY_KEY_INLINE =
  "proliferate.supportReportJobs.v2";
export const SUPPORT_QUEUE_PENDING_KEY_INLINE =
  "proliferate.supportReportJobs.v2.pending";
export const SUPPORT_QUEUE_LEGACY_KEY_INLINE = "proliferate.supportReportJobs.v1";

/**
 * Cheap presence check over just the three keys the sweep can possibly act
 * on -- no document parsing, no migration, no canonical-encoding machinery.
 * A `true` result does not mean there is anything reclaimable, only that the
 * heavier sweep might find something; a `false` result is a guarantee there
 * is nothing local to reap.
 */
async function hasSupportQueueStorageState(
  storage: ProductStorage,
): Promise<boolean> {
  const [primary, pending, legacy] = await Promise.all([
    storage.getItem(SUPPORT_QUEUE_PRIMARY_KEY_INLINE),
    storage.getItem(SUPPORT_QUEUE_PENDING_KEY_INLINE),
    storage.getItem(SUPPORT_QUEUE_LEGACY_KEY_INLINE),
  ]);
  return primary !== null || pending !== null || legacy !== null;
}

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
 *
 * A plain web login has no native `supportSnapshot` bridge and, on a fresh
 * machine or a signed-out visit, none of the three queue storage keys either.
 * That is the common case for this hook's only unconditional mount point
 * (the public auth shell), so it is guarded on both fronts: the storage check
 * above is the only work done eagerly, and the full sweep module -- which
 * drags in the queue document/storage/migration/canonical graph -- is loaded
 * lazily and only when there is something for it to do.
 */
export function useSupportReportRetentionLifecycle(): void {
  const host = useProductHost();
  const storage = host.storage;
  const supportSnapshot = host.desktop?.diagnostics?.supportSnapshot ?? null;
  const { captureException } = useProductTelemetry();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Nothing native to reconcile and nothing local to reap: skip without
      // ever loading the sweep module.
      if (supportSnapshot === null) {
        const hasStorageState = await hasSupportQueueStorageState(storage);
        if (!hasStorageState) return;
      }
      if (cancelled) return;

      const { sweepSupportReportRetention } = await import(
        "./support-report-retention"
      );
      if (cancelled) return;

      await sweepSupportReportRetention({
        storage,
        supportSnapshot,
        now: Date.now(),
        isStale: () => cancelled,
      });
    })().catch((error: unknown) => {
      if (cancelled) return;
      captureException(error);
    });
    return () => {
      cancelled = true;
    };
  }, [storage, supportSnapshot, captureException]);
}
