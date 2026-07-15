import { useMemo } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import type { ProductStorageContext } from "@/lib/infra/persistence/product-storage";

/**
 * Bind the injected {@link ProductStorageContext} (storage + guarded
 * `captureException`) from the mounted ProductHost. Product persistence
 * lifecycle hooks read this and hand it to their plain workflow functions as an
 * explicit argument — the product code never imports a browser/Tauri storage
 * global or a vendor telemetry client directly.
 *
 * The host is an immutable per-mount snapshot, so the returned context is stable
 * for the lifetime of that host. `captureException` is wrapped rather than
 * passed by reference so it keeps its telemetry receiver.
 */
export function useProductStorageContext(): ProductStorageContext {
  const host = useProductHost();
  return useMemo<ProductStorageContext>(
    () => ({
      storage: host.storage,
      captureException: (error, context) =>
        host.telemetry.captureException(error, context),
    }),
    [host],
  );
}
