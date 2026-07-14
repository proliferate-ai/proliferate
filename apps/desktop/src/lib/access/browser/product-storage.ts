import type { ProductStorage } from "@proliferate/product-client/host/product-host";

// Thin asynchronous ProductStorage over the window's localStorage. Browser
// storage exceptions (quota, disabled storage) reject the returned promise
// instead of throwing synchronously. No existing key is copied or migrated.
export const desktopProductStorage: ProductStorage = {
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
