import { useCallback, useEffect, useState } from "react";
import {
  readPersistedJson,
  writePersistedJson,
  type ProductStorageContext,
} from "#product/lib/infra/persistence/product-storage";
import { useProductStorageContext } from "#product/hooks/persistence/facade/use-product-storage-context";

const HARNESS_MANAGED_NOTICE_KEY = "proliferate.harnessManagedNotice.v1";

type DismissedMap = Record<string, true>;

function normalizeDismissedMap(raw: unknown): DismissedMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  return raw as DismissedMap;
}

async function readDismissedMap(context: ProductStorageContext): Promise<DismissedMap> {
  const result = await readPersistedJson<DismissedMap>(context, HARNESS_MANAGED_NOTICE_KEY, {
    parse: normalizeDismissedMap,
    fallback: {},
  });
  return result.status === "settled" ? result.value : {};
}

/**
 * R2.0's one-time settings notice ("Proliferate now maintains its own managed
 * copy…") dismissal, keyed per harness so each harness shows it once
 * independently. A plain per-mount hook (unlike the suppression-map module
 * pattern elsewhere) because this is read/written from exactly one pane, with
 * no cross-mount cache to keep coherent.
 */
export function useHarnessManagedNoticeDismissal(harnessKind: string): {
  isDismissed: boolean;
  hydrated: boolean;
  dismiss: () => void;
} {
  const storageContext = useProductStorageContext();
  const [dismissedMap, setDismissedMap] = useState<DismissedMap | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readDismissedMap(storageContext).then((map) => {
      if (!cancelled) {
        setDismissedMap(map);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [storageContext]);

  const dismiss = useCallback(() => {
    setDismissedMap((current) => {
      const next = { ...(current ?? {}), [harnessKind]: true as const };
      void writePersistedJson(storageContext, HARNESS_MANAGED_NOTICE_KEY, next);
      return next;
    });
  }, [harnessKind, storageContext]);

  return {
    // Reads `false` (not dismissed) before hydration settles; callers gate the
    // notice's own render on `hydrated` too, so a previously dismissed notice
    // never flashes on for one frame before the persisted read resolves.
    isDismissed: dismissedMap?.[harnessKind] === true,
    hydrated: dismissedMap !== null,
    dismiss,
  };
}
