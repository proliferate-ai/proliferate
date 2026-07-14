import type {
  ErrorContext,
  ProductStorage,
} from "@proliferate/product-client/host/product-host";

/**
 * The narrow, explicit context every product-storage operation needs. React
 * lifecycle hooks read both fields from `useProductHost()`
 * (`host.storage` / `host.telemetry.captureException`); plain workflows receive
 * the same object as an argument. There is deliberately no module-global
 * storage or telemetry registry, retry queue, debounce, or serialization queue
 * here — each call is a single best-effort operation over the injected host.
 */
export interface ProductStorageContext {
  storage: ProductStorage;
  captureException: (error: unknown, context?: ErrorContext) => void;
}

/**
 * Result of a persisted read. `ignored` means the caller unmounted or its
 * storage/host was replaced before the read completed (see `isStale`), so the
 * caller must not commit the value — this is how a late read cannot overwrite
 * live state. `settled` always carries a safe value the caller can commit and
 * use to finish hydration.
 */
export type ProductStorageReadResult<T> =
  | { status: "settled"; value: T }
  | { status: "ignored" };

export interface ReadPersistedJsonOptions<T> {
  /**
   * Turn the decoded value into the settled product value. Called with the
   * `JSON.parse` result when the key is present and parses, or `undefined` when
   * the key is missing or its stored string is malformed. This is where a
   * caller applies its own default/normalization for missing or wrong-shaped
   * data — that path never captures an exception.
   */
  parse: (raw: unknown) => T;
  /**
   * The safe default committed when the underlying read rejects (or `parse`
   * itself unexpectedly throws). Distinct from the missing/malformed path,
   * which flows through `parse(undefined)`.
   */
  fallback: T;
  /**
   * Return true once this read's result should be discarded (the lifecycle
   * unmounted or the host/storage was replaced). Checked after the async read
   * settles so a stale result is ignored rather than committed.
   */
  isStale?: () => boolean;
  /** Extra tags/extras merged onto the captured read exception. */
  errorContext?: ErrorContext;
}

const READ_ERROR_TAGS = { domain: "product_storage", action: "read" } as const;
const WRITE_ERROR_TAGS = { domain: "product_storage", action: "write" } as const;
const REMOVE_ERROR_TAGS = {
  domain: "product_storage",
  action: "remove",
} as const;

/**
 * Capture an exception through the injected telemetry callback without ever
 * letting the callback's own failure escape. A throwing or promise-rejecting
 * `captureException` must never strand hydration or suppress a later write, so
 * this swallows both synchronous throws and rejected promises.
 */
function guardedCapture(
  context: ProductStorageContext,
  error: unknown,
  errorContext: ErrorContext,
): void {
  try {
    const result = context.captureException(error, errorContext) as unknown;
    if (
      result !== null &&
      typeof result === "object" &&
      typeof (result as PromiseLike<unknown>).then === "function"
    ) {
      void (result as Promise<unknown>).then(undefined, () => {});
    }
  } catch {
    // Best-effort: a broken telemetry callback cannot break persistence.
  }
}

function mergeErrorContext(
  key: string,
  baseTags: Record<string, string>,
  errorContext: ErrorContext | undefined,
): ErrorContext {
  return {
    ...errorContext,
    tags: { ...baseTags, key, ...errorContext?.tags },
  };
}

function decodeStoredJson(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // Malformed value → caller normalization/default via parse(undefined).
    return undefined;
  }
}

/**
 * Read a JSON-serialized product value through the injected ProductStorage.
 *
 * Semantics (per the persistence contract):
 * - missing key → `parse(undefined)` (caller default), settles;
 * - malformed / wrong-shaped value → `parse(undefined)` or caller shape check,
 *   settles, no capture;
 * - read rejection → capture a typed read exception, commit `fallback`, settle;
 * - stale (unmount/replacement) → `ignored`, nothing committed;
 * - hydration always settles even if the telemetry callback throws/rejects.
 */
export async function readPersistedJson<T>(
  context: ProductStorageContext,
  key: string,
  options: ReadPersistedJsonOptions<T>,
): Promise<ProductStorageReadResult<T>> {
  let stored: string | null;
  try {
    stored = await context.storage.getItem(key);
  } catch (error) {
    if (options.isStale?.()) return { status: "ignored" };
    guardedCapture(
      context,
      error,
      mergeErrorContext(key, READ_ERROR_TAGS, options.errorContext),
    );
    return { status: "settled", value: options.fallback };
  }

  if (options.isStale?.()) return { status: "ignored" };

  try {
    return { status: "settled", value: options.parse(decodeStoredJson(stored)) };
  } catch (error) {
    // A `parse` that throws is not the expected malformed/wrong-shape path;
    // capture it and still settle so hydration is never blocked.
    guardedCapture(
      context,
      error,
      mergeErrorContext(key, READ_ERROR_TAGS, options.errorContext),
    );
    return { status: "settled", value: options.fallback };
  }
}

/**
 * Convenience wrapper matching the legacy `readPersistedValue<T>` shape:
 * decode a JSON value and return it, or `undefined` on a missing/malformed key
 * or a captured read rejection. For load/migration workflows whose enclosing
 * lifecycle already guards against a late (post-unmount) commit; callers that
 * need staleness handling use {@link readPersistedJson} directly.
 */
export async function readPersistedJsonValue<T>(
  context: ProductStorageContext,
  key: string,
  errorContext?: ErrorContext,
): Promise<T | undefined> {
  const result = await readPersistedJson<T | undefined>(context, key, {
    parse: (raw) => raw as T | undefined,
    fallback: undefined,
    errorContext,
  });
  return result.status === "settled" ? result.value : undefined;
}

/**
 * Convenience wrapper for a bare-string key: return the stored string, or
 * `undefined` on a missing key or a captured read rejection. Mirrors
 * {@link readPersistedJsonValue} for {@link readPersistedString}.
 */
export async function readPersistedStringValue(
  context: ProductStorageContext,
  key: string,
  errorContext?: ErrorContext,
): Promise<string | undefined> {
  const result = await readPersistedString(context, key, { errorContext });
  return result.status === "settled" ? result.value ?? undefined : undefined;
}

export interface ReadPersistedStringOptions {
  /**
   * Return true once this read's result should be discarded (unmount/host
   * replacement). Checked after the async read settles, mirroring
   * {@link readPersistedJson}.
   */
  isStale?: () => boolean;
  /** Extra tags/extras merged onto the captured read exception. */
  errorContext?: ErrorContext;
}

/**
 * Read a raw string product value through the injected ProductStorage — the
 * counterpart to {@link readPersistedJson} for the small set of keys whose
 * on-disk representation is a bare string (never JSON-encoded), e.g. the
 * selected logical workspace id, the local automation executor id, and the
 * legacy theme/model preference keys. Using the raw string preserves those
 * existing values with zero migration; JSON-decoding them would lose data.
 *
 * Semantics match {@link readPersistedJson}: missing key → `null` (caller
 * default), read rejection → captured typed exception + `null`, stale →
 * `ignored`, and hydration always settles even if telemetry throws/rejects.
 */
export async function readPersistedString(
  context: ProductStorageContext,
  key: string,
  options: ReadPersistedStringOptions = {},
): Promise<ProductStorageReadResult<string | null>> {
  let stored: string | null;
  try {
    stored = await context.storage.getItem(key);
  } catch (error) {
    if (options.isStale?.()) return { status: "ignored" };
    guardedCapture(
      context,
      error,
      mergeErrorContext(key, READ_ERROR_TAGS, options.errorContext),
    );
    return { status: "settled", value: null };
  }

  if (options.isStale?.()) return { status: "ignored" };

  return { status: "settled", value: stored };
}

/**
 * Write a raw string product value through the injected ProductStorage (no JSON
 * encoding). Same capture-once/keep-state failure semantics as
 * {@link writePersistedJson}.
 */
export async function writePersistedString(
  context: ProductStorageContext,
  key: string,
  value: string,
  errorContext?: ErrorContext,
): Promise<void> {
  try {
    await context.storage.setItem(key, value);
  } catch (error) {
    guardedCapture(
      context,
      error,
      mergeErrorContext(key, WRITE_ERROR_TAGS, errorContext),
    );
  }
}

/**
 * Write a JSON-serialized product value through the injected ProductStorage. A
 * failed write is captured once for this attempt and swallowed: the caller's
 * in-memory state is kept and a later write can still succeed. There is no
 * retry, rollback, or queue.
 */
export async function writePersistedJson(
  context: ProductStorageContext,
  key: string,
  value: unknown,
  errorContext?: ErrorContext,
): Promise<void> {
  try {
    await context.storage.setItem(key, JSON.stringify(value));
  } catch (error) {
    guardedCapture(
      context,
      error,
      mergeErrorContext(key, WRITE_ERROR_TAGS, errorContext),
    );
  }
}

/**
 * Remove a product key through the injected ProductStorage (`removeItem`
 * passthrough). A failed removal is captured once and swallowed.
 */
export async function removePersistedKey(
  context: ProductStorageContext,
  key: string,
  errorContext?: ErrorContext,
): Promise<void> {
  try {
    await context.storage.removeItem(key);
  } catch (error) {
    guardedCapture(
      context,
      error,
      mergeErrorContext(key, REMOVE_ERROR_TAGS, errorContext),
    );
  }
}
