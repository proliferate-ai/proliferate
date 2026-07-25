import { useMemo } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";

import type { ProductStorageContext } from "@/lib/infra/persistence/product-storage";

/** Stable product persistence dependencies from the currently mounted host. */
export function useProductStorageContext(): ProductStorageContext {
  const { storage, telemetry } = useProductHost();
  return useMemo(() => ({
    storage,
    captureException: telemetry.captureException,
  }), [storage, telemetry.captureException]);
}
