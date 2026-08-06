import { useMemo, useRef, useState } from "react";
import {
  createManagedWorkflowLaunchAttempt,
  createWorkflowArgumentDraft,
  normalizeWorkflowArguments,
  referencedWorkflowInputNames,
  type ManagedWorkflowLaunchAttempt,
  type WorkflowArgumentIssue,
} from "#product/domain/workflows/arguments";
import type { WorkflowDefinition } from "#product/domain/workflows/definition";
import { useWorkflowRunLaunchAccess } from "#product/hooks/access/cloud/workflows/use-workflow-run-access";
import {
  dedupeWorkflowRunHistory,
  inspectWorkflowCloudError,
  safeWorkflowActionError,
} from "#product/lib/domain/workflows/workflow-run-state";

export const WORKFLOW_OPERATION_TIMEOUT_MS = 15_000;

export function useWorkflowRunLaunchActions({
  authCacheScope,
  definition,
  managedRunsEnabled,
  onOpenRun,
}: {
  authCacheScope: string;
  definition: WorkflowDefinition;
  managedRunsEnabled: boolean;
  onOpenRun: (runId: string) => void;
}) {
  const { eligibility, history, actions } = useWorkflowRunLaunchAccess(
    definition.id,
    definition.revision,
    authCacheScope,
  );
  const definitionKey = `${definition.id}:${definition.revision}`;
  const freshDraft = useMemo(
    () => createWorkflowArgumentDraft(definition.inputs),
    [definitionKey, definition.inputs],
  );
  const [argumentState, setArgumentState] = useState<{
    definitionKey: string;
    draft: ReturnType<typeof createWorkflowArgumentDraft>;
    issues: WorkflowArgumentIssue[];
  }>(() => ({ definitionKey, draft: freshDraft, issues: [] }));
  const currentArguments = argumentState.definitionKey === definitionKey
    ? argumentState
    : { definitionKey, draft: freshDraft, issues: [] };
  const [attempt, setAttempt] = useState<ManagedWorkflowLaunchAttempt | null>(null);
  const [attemptMessage, setAttemptMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const launchInFlight = useRef(false);
  const prompt = definition.stages[0]?.steps[0]?.prompt ?? "";
  const runs = useMemo(() => dedupeWorkflowRunHistory(history.data), [history.data]);

  const executeAttempt = async (
    current: ManagedWorkflowLaunchAttempt,
    lockAlreadyHeld = false,
  ) => {
    if (!lockAlreadyHeld && launchInFlight.current) {
      return;
    }
    if (!lockAlreadyHeld) {
      launchInFlight.current = true;
    }
    setBusy(true);
    setError(null);
    setAttemptMessage(null);
    try {
      await runWorkflowOperationWithTimeout((signal) => actions.putWorkflowInvocation({
        invocationId: current.invocationId,
        body: current.request,
        signal,
      }));
      const delivered = await runWorkflowOperationWithTimeout((signal) =>
        actions.deliverWorkflowInvocation({
          invocationId: current.invocationId,
          signal,
        })
      );
      setAttempt(null);
      onOpenRun(delivered.id);
    } catch (caught) {
      setAttempt(current);
      setAttemptMessage("This launch may already exist. Check or retry the same run identity.");
      setError(safeWorkflowActionError(caught));
    } finally {
      if (!lockAlreadyHeld) {
        launchInFlight.current = false;
      }
      setBusy(false);
    }
  };

  const submit = () => {
    if (
      launchInFlight.current
      || attempt !== null
      || eligibility.isLoading
      || eligibility.isError
      || history.isLoading
      || history.isError
      || !eligibility.data?.eligible
      || !managedRunsEnabled
    ) {
      return;
    }
    const normalized = normalizeWorkflowArguments(
      definition.inputs,
      prompt,
      currentArguments.draft,
    );
    setArgumentState({ ...currentArguments, issues: normalized.issues });
    if (normalized.issues.length > 0) {
      return;
    }
    const current = createManagedWorkflowLaunchAttempt(
      crypto.randomUUID(),
      definition.id,
      definition.revision,
      normalized.arguments,
    );
    setAttempt(current);
    void executeAttempt(current);
  };

  const recover = async () => {
    if (!attempt || launchInFlight.current) {
      return;
    }
    launchInFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const existing = await runWorkflowOperationWithTimeout((signal) =>
        actions.checkWorkflowInvocation({
          invocationId: attempt.invocationId,
          signal,
        })
      );
      if (existing.managedExecution.deliveryStatus === "prepared") {
        const delivered = await runWorkflowOperationWithTimeout((signal) =>
          actions.deliverWorkflowInvocation({
            invocationId: attempt.invocationId,
            signal,
          })
        );
        setAttempt(null);
        onOpenRun(delivered.id);
      } else {
        setAttempt(null);
        onOpenRun(existing.id);
      }
    } catch (caught) {
      if (inspectWorkflowCloudError(caught)?.status === 404) {
        await executeAttempt(attempt, true);
        return;
      }
      setError(safeWorkflowActionError(caught));
    } finally {
      launchInFlight.current = false;
      setBusy(false);
    }
  };

  return {
    inputs: definition.inputs,
    draft: currentArguments.draft,
    issues: currentArguments.issues,
    blockers: eligibility.data?.blockers ?? [],
    requiredForRunInputNames: referencedWorkflowInputNames(prompt),
    capabilityEnabled: managedRunsEnabled,
    launchBlocked: eligibility.isError || history.isError || attempt !== null,
    submitting: busy || eligibility.isLoading || history.isLoading,
    serverError: eligibility.isError
      ? "Run eligibility could not be loaded."
      : history.isError
        ? "Recent run history must load before starting another run."
        : error,
    attemptMessage,
    onChange: (next: ReturnType<typeof createWorkflowArgumentDraft>) => {
      setArgumentState({ definitionKey, draft: next, issues: [] });
    },
    onSubmit: submit,
    onRetryAttempt: attempt
      ? () => {
          void recover();
        }
      : undefined,
    runs,
    historyLoading: history.isLoading,
    historyError: history.isError ? "Run history could not be loaded." : null,
    hasMore: history.hasNextPage,
    loadingMore: history.isFetchingNextPage,
    onSelectRun: onOpenRun,
    onLoadMore: () => {
      void history.fetchNextPage();
    },
    onRetryHistory: () => {
      void history.refetch();
    },
  };
}

export async function runWorkflowOperationWithTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    WORKFLOW_OPERATION_TIMEOUT_MS,
  );
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}
