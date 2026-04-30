import { useEffect, useMemo, useRef } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import type {
  AnyHarnessRequestOptions,
  AnyHarnessTimingCategory,
} from "@anyharness/sdk";

export interface AnyHarnessCacheDecisionEvent {
  category: AnyHarnessTimingCategory;
  decision: "hit" | "miss" | "stale" | "skipped";
  source: "react_query";
}

export interface AnyHarnessQueryTimingOptions {
  requestOptions?: AnyHarnessRequestOptions;
  onCacheDecision?: (event: AnyHarnessCacheDecisionEvent) => void;
}

export function useReportAnyHarnessCacheDecision(input: {
  category: AnyHarnessTimingCategory;
  enabled: boolean;
  queryKey: QueryKey;
  onCacheDecision?: (event: AnyHarnessCacheDecisionEvent) => void;
}): void {
  const queryClient = useQueryClient();
  const reportedSignatureRef = useRef<string | null>(null);
  const queryKeyHash = useMemo(() => JSON.stringify(input.queryKey), [input.queryKey]);

  useEffect(() => {
    if (!input.onCacheDecision) {
      return;
    }

    const state = queryClient.getQueryState(input.queryKey);
    const decision = resolveAnyHarnessCacheDecision(input.enabled, state);
    const signature = [
      input.category,
      queryKeyHash,
      decision,
      state?.dataUpdatedAt ?? 0,
      state?.fetchStatus ?? "none",
    ].join(":");
    if (reportedSignatureRef.current === signature) {
      return;
    }
    reportedSignatureRef.current = signature;
    input.onCacheDecision({
      category: input.category,
      decision,
      source: "react_query",
    });
  }, [
    input.category,
    input.enabled,
    input.onCacheDecision,
    input.queryKey,
    queryClient,
    queryKeyHash,
  ]);
}

export function resolveAnyHarnessCacheDecision(
  enabled: boolean,
  state: { dataUpdatedAt: number; isInvalidated: boolean } | undefined,
): "hit" | "miss" | "stale" | "skipped" {
  if (!enabled) {
    return "skipped";
  }
  if (!state || state.dataUpdatedAt === 0) {
    return "miss";
  }
  if (state.isInvalidated) {
    return "stale";
  }
  return "hit";
}
