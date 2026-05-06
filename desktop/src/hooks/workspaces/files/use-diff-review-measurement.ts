import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  useAnyHarnessRuntimeContext,
  type AnyHarnessCacheDecisionEvent,
  type AnyHarnessQueryTimingOptions,
} from "@anyharness/sdk-react";
import type { AnyHarnessTimingCategory } from "@anyharness/sdk";
import {
  bindMeasurementCategories,
  finishOrCancelMeasurementOperation,
  getMeasurementRequestOptions,
  hashMeasurementScope,
  isDebugMeasurementEnabled,
  onMeasurementOperationFinish,
  recordMeasurementMetric,
  startMeasurementOperation,
  type MeasurementOperationId,
} from "@/lib/infra/debug-measurement";

const DIFF_REVIEW_IDLE_TIMEOUT_MS = 1_000;
const DIFF_REVIEW_MAX_DURATION_MS = 6_000;
const DIFF_REVIEW_BINDING_TTL_MS = 6_000;
const DIFF_REVIEW_COOLDOWN_MS = 15_000;
const DIFF_REVIEW_CATEGORIES = [
  "git.status",
  "git.diff",
  "git.branch_diff_files",
] as const;

interface DiffReviewMeasurement {
  operationId: MeasurementOperationId | null;
  deferQueryMount: boolean;
  statusTimingOptions: AnyHarnessQueryTimingOptions;
  branchDiffFilesTimingOptions: AnyHarnessQueryTimingOptions;
  diffTimingOptions: AnyHarnessQueryTimingOptions;
}

export function useDiffReviewMeasurement(): DiffReviewMeasurement {
  const runtime = useAnyHarnessRuntimeContext();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";
  const runtimeUrlHash = useMemo(
    () => runtimeUrl ? hashMeasurementScope(runtimeUrl) : undefined,
    [runtimeUrl],
  );
  const shouldStartMeasurement = isDebugMeasurementEnabled();
  const currentScopeHash = runtimeUrlHash ?? null;
  const operationRef = useRef<MeasurementOperationId | null>(null);
  const [sampleAttempted, setSampleAttempted] = useState(!shouldStartMeasurement);
  const [sampleScopeHash, setSampleScopeHash] = useState<string | null>(
    shouldStartMeasurement ? null : currentScopeHash,
  );
  const [operationId, setOperationId] = useState<MeasurementOperationId | null>(null);

  useLayoutEffect(() => {
    if (!shouldStartMeasurement) {
      operationRef.current = null;
      setOperationId(null);
      setSampleAttempted(true);
      setSampleScopeHash(currentScopeHash);
      return () => undefined;
    }

    setSampleAttempted(false);
    setSampleScopeHash(null);
    const nextOperationId = startMeasurementOperation({
      kind: "diff_review_sample",
      surfaces: ["all-changes-frame", "diff-viewer"],
      sampleKey: "diff_review",
      idleTimeoutMs: DIFF_REVIEW_IDLE_TIMEOUT_MS,
      maxDurationMs: DIFF_REVIEW_MAX_DURATION_MS,
      cooldownMs: DIFF_REVIEW_COOLDOWN_MS,
    });
    operationRef.current = nextOperationId;
    setOperationId(nextOperationId);
    setSampleAttempted(true);
    setSampleScopeHash(currentScopeHash);

    const unbind = nextOperationId
      ? bindMeasurementCategories({
        operationId: nextOperationId,
        categories: DIFF_REVIEW_CATEGORIES,
        scope: { runtimeUrlHash, sampleKey: "diff_review" },
        ttlMs: DIFF_REVIEW_BINDING_TTL_MS,
      })
      : () => undefined;
    const unsubscribeFinish = nextOperationId
      ? onMeasurementOperationFinish(nextOperationId, () => {
        if (operationRef.current === nextOperationId) {
          operationRef.current = null;
          setOperationId(null);
        }
      })
      : () => undefined;

    return () => {
      unsubscribeFinish();
      unbind();
      finishOrCancelMeasurementOperation(nextOperationId, "unmount");
      if (operationRef.current === nextOperationId) {
        operationRef.current = null;
      }
    };
  }, [currentScopeHash, runtimeUrlHash, shouldStartMeasurement]);

  const onCacheDecision = useCallback((event: AnyHarnessCacheDecisionEvent) => {
    const currentOperationId = operationRef.current;
    if (!currentOperationId) {
      return;
    }
    recordMeasurementMetric({
      type: "cache",
      operationId: currentOperationId,
      category: event.category,
      decision: event.decision,
      source: event.source,
    });
  }, []);

  const statusTimingOptions = useTimingOptions(
    operationId,
    "git.status",
    onCacheDecision,
  );
  const branchDiffFilesTimingOptions = useTimingOptions(
    operationId,
    "git.branch_diff_files",
    onCacheDecision,
  );
  const diffTimingOptions = useTimingOptions(
    operationId,
    "git.diff",
    onCacheDecision,
  );

  return {
    operationId,
    deferQueryMount: shouldStartMeasurement
      && (!sampleAttempted || sampleScopeHash !== currentScopeHash),
    statusTimingOptions,
    branchDiffFilesTimingOptions,
    diffTimingOptions,
  };
}

function useTimingOptions(
  operationId: MeasurementOperationId | null,
  category: AnyHarnessTimingCategory,
  onCacheDecision: NonNullable<AnyHarnessQueryTimingOptions["onCacheDecision"]>,
): AnyHarnessQueryTimingOptions {
  return useMemo(() => ({
    requestOptions: getMeasurementRequestOptions({ operationId, category }),
    onCacheDecision,
  }), [category, onCacheDecision, operationId]);
}
