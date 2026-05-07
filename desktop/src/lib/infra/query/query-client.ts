import {
  MutationCache,
  QueryCache,
  QueryClient,
} from "@tanstack/react-query";
import { captureTelemetryException } from "@/lib/integrations/telemetry/client";

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

function createAppQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (query.meta?.telemetryHandled) {
          return;
        }

        captureTelemetryException(error, {
          tags: {
            action: "query_error",
            domain: "react_query",
          },
          extras: {
            query_hash: query.queryHash,
          },
        });
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        if (mutation.meta?.telemetryHandled) {
          return;
        }

        const mutationKey = mutation.options.mutationKey;
        captureTelemetryException(error, {
          tags: {
            action: "mutation_error",
            domain: "react_query",
          },
          extras: {
            mutation_key:
              mutationKey === undefined
                ? "unknown"
                : hashAppQueryKey(mutationKey),
          },
        });
      },
    }),
    defaultOptions: {
      queries: {
        queryKeyHashFn: hashAppQueryKey,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

export const appQueryClient = createAppQueryClient();
