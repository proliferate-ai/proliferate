import type {
  ErrorContext,
  ProductStorage,
} from "@proliferate/product-client/host/product-host";

export type ProductStorageOperation = "read" | "parse" | "write" | "remove";

/** A typed, non-secret description of one failed product persistence operation. */
export class ProductStorageOperationError extends Error {
  readonly cause: unknown;
  readonly key: string;
  readonly operation: ProductStorageOperation;

  constructor(
    operation: ProductStorageOperation,
    key: string,
    cause: unknown,
  ) {
    super(`Product storage ${operation} failed for ${key}.`);
    this.name = "ProductStorageOperationError";
    this.cause = cause;
    this.key = key;
    this.operation = operation;
  }
}

export interface ProductStorageContext {
  storage: ProductStorage;
  captureException: (
    error: unknown,
    context?: ErrorContext,
  ) => void | Promise<void>;
}

function captureStorageFailure(
  context: ProductStorageContext,
  error: ProductStorageOperationError,
): void {
  try {
    const result = context.captureException(error, {
      tags: {
        domain: "product_persistence",
        operation: error.operation,
      },
      extras: { key: error.key },
    });
    void Promise.resolve(result).catch(() => undefined);
  } catch {
    // Persistence completion never depends on telemetry transport health.
  }
}

export async function readProductStorageText(
  context: ProductStorageContext,
  key: string,
): Promise<string | undefined> {
  try {
    return (await context.storage.getItem(key)) ?? undefined;
  } catch (cause) {
    captureStorageFailure(
      context,
      new ProductStorageOperationError("read", key, cause),
    );
    return undefined;
  }
}

export async function readProductStorageJson<T>(
  context: ProductStorageContext,
  key: string,
): Promise<T | undefined> {
  const raw = await readProductStorageText(context, key);
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch (cause) {
    captureStorageFailure(
      context,
      new ProductStorageOperationError("parse", key, cause),
    );
    return undefined;
  }
}

export async function writeProductStorageJson(
  context: ProductStorageContext,
  key: string,
  value: unknown,
): Promise<boolean> {
  try {
    const serialized = JSON.stringify(value);
    await context.storage.setItem(key, serialized);
    return true;
  } catch (cause) {
    captureStorageFailure(
      context,
      new ProductStorageOperationError("write", key, cause),
    );
    return false;
  }
}

export async function writeProductStorageText(
  context: ProductStorageContext,
  key: string,
  value: string,
): Promise<boolean> {
  try {
    await context.storage.setItem(key, value);
    return true;
  } catch (cause) {
    captureStorageFailure(
      context,
      new ProductStorageOperationError("write", key, cause),
    );
    return false;
  }
}

export async function removeProductStorageItem(
  context: ProductStorageContext,
  key: string,
): Promise<boolean> {
  try {
    await context.storage.removeItem(key);
    return true;
  } catch (cause) {
    captureStorageFailure(
      context,
      new ProductStorageOperationError("remove", key, cause),
    );
    return false;
  }
}
