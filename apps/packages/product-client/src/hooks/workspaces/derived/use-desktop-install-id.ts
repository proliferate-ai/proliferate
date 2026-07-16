import { useEffect, useState } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";

/**
 * This Mac's native desktop worker install id, or null when there is no native
 * worker (Web, or a Desktop build without an enrolled worker).
 *
 * The worker install id is the durable, server-legible device identity — never
 * a telemetry/anonymous fallback — so passing it to Cloud list/detail fetches
 * lets the server select and un-redact THIS device's local materialization.
 */
export function useDesktopInstallId(): string | null {
  const worker = useProductHost().desktop?.worker ?? null;
  const [installId, setInstallId] = useState<string | null>(null);

  useEffect(() => {
    if (!worker) {
      setInstallId(null);
      return;
    }
    let cancelled = false;
    void worker
      .getInstallId()
      .then((id) => {
        if (!cancelled) {
          setInstallId(id?.trim() || null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setInstallId(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [worker]);

  return installId;
}
