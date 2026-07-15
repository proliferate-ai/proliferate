import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import type { ProductEntry } from "@proliferate/product-client/host/product-host";
import { productEntryRoute } from "@/lib/domain/auth/desktop-navigation";

/**
 * The single inbound-navigation seam. Subscribes ONCE to the host's inbound
 * ProductEntry stream — the initial snapshot the process launched with plus
 * every entry that arrives afterwards — maps each entry to its shared route,
 * and navigates. Auth-callback URLs are consumed by the auth transport and
 * never surface here.
 *
 * There is no replay, retry, queue, or persistence: a navigation failure is
 * reported through host telemetry and dropped, and unsubscribing (unmount or a
 * host that publishes a new links implementation) prevents any later delivery.
 *
 * `navigate`/`captureException` are read through refs so a router or host
 * snapshot change does not tear down and re-subscribe the observer; the
 * subscription lifecycle is keyed only to the observe function itself.
 */
export function useProductEntryRouting(): void {
  const host = useProductHost();
  const navigate = useNavigate();
  const observeInboundEntries = host.links.observeInboundEntries;
  const captureException = host.telemetry.captureException;

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const captureExceptionRef = useRef(captureException);
  captureExceptionRef.current = captureException;

  useEffect(() => {
    const unsubscribe = observeInboundEntries((entry: ProductEntry) => {
      const target = productEntryRoute(entry);
      try {
        navigateRef.current(target);
      } catch (error) {
        // Report and drop: the host never retries, persists, or queues the
        // entry, so a failed navigation is not replayed.
        captureExceptionRef.current(error, {
          tags: { domain: "navigation", action: "product_entry_routing" },
        });
      }
    });
    return unsubscribe;
  }, [observeInboundEntries]);
}
