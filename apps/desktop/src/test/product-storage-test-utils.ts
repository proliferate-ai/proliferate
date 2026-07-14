import type {
  ErrorContext,
  ProductStorage,
} from "@proliferate/product-client/host/product-host";
import type { ProductStorageContext } from "@/lib/infra/persistence/product-storage";

/**
 * An in-memory {@link ProductStorage} for persistence tests. Its `values` map
 * holds native values (objects/strings) and `getItem` surfaces them exactly the
 * way the real Desktop adapter does — returning stored strings verbatim and
 * JSON-stringifying non-string values — so a test can seed a legacy bare string
 * or a JSON object the same way it did against the old Tauri-store mock.
 *
 * Writes go through the JSON/string helpers, which store serialized strings;
 * use {@link MemoryProductStorage.readJson} to decode a written value.
 */
export interface MemoryProductStorage {
  values: Map<string, unknown>;
  storage: ProductStorage;
  context: ProductStorageContext;
  readJson<T = unknown>(key: string): T | undefined;
}

export function createMemoryProductStorage(
  captureException: (error: unknown, context?: ErrorContext) => void = () => {},
): MemoryProductStorage {
  const values = new Map<string, unknown>();
  const storage: ProductStorage = {
    async getItem(key: string): Promise<string | null> {
      if (!values.has(key)) return null;
      const value = values.get(key);
      if (value === undefined || value === null) return null;
      return typeof value === "string" ? value : JSON.stringify(value);
    },
    async setItem(key: string, value: string): Promise<void> {
      values.set(key, value);
    },
    async removeItem(key: string): Promise<void> {
      values.delete(key);
    },
  };
  const readJson = <T = unknown>(key: string): T | undefined => {
    if (!values.has(key)) return undefined;
    const value = values.get(key);
    if (value === undefined) return undefined;
    return (typeof value === "string" ? JSON.parse(value) : value) as T;
  };
  return { values, storage, context: { storage, captureException }, readJson };
}
