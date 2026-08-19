import {
  isCancelledError,
  MutationCache,
  QueryCache,
  QueryClient,
} from "@tanstack/react-query";
import {
  hasAnyHarnessRuntimeIncidentReceipt,
  toAnyHarnessTelemetryError,
} from "@anyharness/sdk";
import {
  isExpectedMutationTelemetryError,
  isExpectedQueryTelemetryError,
} from "#product/lib/domain/telemetry/failures";
import { fingerprintTelemetryKey } from "#product/lib/domain/telemetry/key-fingerprint";

/**
 * The narrow exception-capture dependency the query cache reports through. The
 * product-owned client imports no vendor sink directly; the host composition
 * injects its concrete `captureException` (Desktop routes it to the telemetry
 * transport) so there is exactly one QueryClient instance and one capture path.
 */
// Named exception (does not sit on the `cadence` scale): 30s falls strictly
// between `cadence.relaxedMs` (15s) and `cadence.slowMs` (60s) — the same
// band `WORKSPACE_COLLECTIONS_STALE_MS` occupies. This is the global
// react-query fallback applied to every query in the app that does not
// declare its own `staleTime`, not a single site's polling cadence; snapping
// it to either token would shift every un-opted-in query's default freshness
// window app-wide, which is out of scope for a per-site migration. Kept as
// its own named constant rather than force-fit (UX Latency + Transitions ADR
// §4.7, Rung 6, Q8).
const DEFAULT_QUERY_STALE_MS = 30_000;

export interface AppQueryClientDeps {
  captureException: (
    error: unknown,
    context: {
      tags: Record<string, string>;
      extras: Record<string, unknown>;
    },
  ) => void;
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeQueryKeyForHash(
  value: unknown,
  seen: WeakSet<object>,
): unknown {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "bigint") {
    return `${value.toString()}n`;
  }
  if (typeof value === "undefined") {
    return null;
  }
  if (typeof value === "symbol") {
    return value.description ? `Symbol(${value.description})` : "Symbol()";
  }
  if (typeof value === "function") {
    return `[Function:${value.name || "anonymous"}]`;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof URL) {
    return value.toString();
  }

  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => normalizeQueryKeyForHash(item, seen));
  }

  if (!isPlainObject(value)) {
    return `[${value.constructor?.name || "Object"}]`;
  }

  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      try {
        result[key] = normalizeQueryKeyForHash(
          (value as Record<string, unknown>)[key],
          seen,
        );
      } catch {
        result[key] = "[Unhashable]";
      }
      return result;
    }, {});
}

export function hashAppQueryKey(queryKey: unknown): string {
  try {
    return JSON.stringify(normalizeQueryKeyForHash(queryKey, new WeakSet()));
  } catch {
    return JSON.stringify(["unhashable-query-key"]);
  }
}

export function shouldCaptureAppQueryError(error: unknown): boolean {
  return !hasAnyHarnessRuntimeIncidentReceipt(error)
    && !isCancelledError(error)
    && !isExpectedQueryTelemetryError(error);
}

export function shouldCaptureAppMutationError(error: unknown): boolean {
  return !hasAnyHarnessRuntimeIncidentReceipt(error)
    && !isExpectedMutationTelemetryError(error);
}

export function createAppQueryClient({
  captureException,
}: AppQueryClientDeps): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (
          query.meta?.telemetryHandled
          || !shouldCaptureAppQueryError(error)
        ) {
          return;
        }

        captureException(toAnyHarnessTelemetryError(error), {
          tags: {
            action: "query_error",
            domain: "react_query",
          },
          extras: {
            query_hash: fingerprintTelemetryKey(query.queryHash),
          },
        });
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        if (
          mutation.meta?.telemetryHandled
          || !shouldCaptureAppMutationError(error)
        ) {
          return;
        }

        const mutationKey = mutation.options.mutationKey;
        captureException(toAnyHarnessTelemetryError(error), {
          tags: {
            action: "mutation_error",
            domain: "react_query",
          },
          extras: {
            mutation_key:
              mutationKey === undefined
                ? "unknown"
                : fingerprintTelemetryKey(hashAppQueryKey(mutationKey)),
          },
        });
      },
    }),
    defaultOptions: {
      queries: {
        queryKeyHashFn: hashAppQueryKey,
        staleTime: DEFAULT_QUERY_STALE_MS,
        refetchOnWindowFocus: false,
        retry: 1,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}
