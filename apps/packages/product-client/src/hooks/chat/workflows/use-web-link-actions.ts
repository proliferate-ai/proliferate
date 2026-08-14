import { useCallback, useMemo } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";

export function useWebLinkActions(href: string) {
  const host = useProductHost();
  const normalizedHref = useMemo(
    () => href.includes("://") ? href : `https://${href}`,
    [href],
  );
  const openInBrowser = useCallback(async () => {
    await host.links.openExternal(normalizedHref);
  }, [host.links, normalizedHref]);
  const copyLink = useCallback(async () => {
    await host.clipboard.writeText(normalizedHref);
  }, [host.clipboard, normalizedHref]);

  return { normalizedHref, openInBrowser, copyLink };
}
