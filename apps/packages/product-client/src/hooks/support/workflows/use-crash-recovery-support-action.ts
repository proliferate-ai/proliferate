import { useCallback } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";

import { SUPPORT_EMAIL_ADDRESS } from "#product/config/capabilities";
import { useSupportMenuAction } from "#product/hooks/support/derived/use-support-menu-action";
import { crashRecoverySupportDestination } from "#product/lib/domain/support/support-menu-action";

/**
 * Resolve a support action that remains usable after the normal product tree
 * has crashed. Capability routing still prevents self-managed users from being
 * sent to Proliferate vendor support.
 */
export function useCrashRecoverySupportAction(): (() => Promise<void>) | null {
  const host = useProductHost();
  const supportAction = useSupportMenuAction();
  const destination = crashRecoverySupportDestination(
    supportAction,
    SUPPORT_EMAIL_ADDRESS,
  );
  const openSupport = useCallback(async () => {
    if (destination) await host.links.openExternal(destination);
  }, [destination, host.links]);
  return destination ? openSupport : null;
}
