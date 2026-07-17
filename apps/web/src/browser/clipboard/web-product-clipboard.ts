import type { ProductClipboard } from "@proliferate/product-client/host/product-host";

/**
 * The Web `host.clipboard` adapter: writes through the browser
 * `navigator.clipboard` API. A rejected write (permission denied, insecure
 * context) propagates so the shared product action observes the failure rather
 * than the host swallowing it and claiming success.
 */
export const webProductClipboard: ProductClipboard = {
  writeText(value: string): Promise<void> {
    return navigator.clipboard.writeText(value);
  },
};
