import type { ProductStorage } from "@proliferate/product-client/host/product-host";

/**
 * The Web `host.storage` adapter: non-secret, device-local product state
 * (appearance, drafts, recent selections) backed by `window.localStorage`.
 *
 * This is the ONLY browser-storage surface the Web host exposes to the product.
 * It must never hold login credentials, provider API keys, SSH credentials, or
 * PKCE secrets — the production session lives in an HttpOnly refresh cookie plus
 * an in-memory access token, and the PKCE transaction lives in `sessionStorage`
 * behind the auth transport, neither of which routes through here.
 *
 * Storage exceptions (private-browsing, disabled storage, quota) reject the
 * returned promise rather than throwing synchronously, so the shared
 * product-storage helper observes the failure and surfaces the existing
 * product-visible behavior. The host never swallows a failure and claims
 * success.
 */
export const webProductStorage: ProductStorage = {
  async getItem(key: string): Promise<string | null> {
    return window.localStorage.getItem(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    window.localStorage.setItem(key, value);
  },
  async removeItem(key: string): Promise<void> {
    window.localStorage.removeItem(key);
  },
};
