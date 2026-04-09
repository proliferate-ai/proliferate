import {
  MutationCache,
  QueryCache,
  QueryClient,
} from "@tanstack/react-query";
import { captureTelemetryException } from "@/lib/integrations/telemetry/client";

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
                : JSON.stringify(mutationKey),
          },
        });
      },
    }),
    defaultOptions: {
      queries: {
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
