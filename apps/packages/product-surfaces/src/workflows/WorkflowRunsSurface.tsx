import { useMemo, useRef, useState } from "react";
import type {
  ManagedWorkflowInvocationResponse,
  ManagedWorkflowOpenTarget,
} from "@proliferate/cloud-sdk";
import {
  useWorkflowRun,
  useWorkflowRunActions,
  useWorkflowRunEligibility,
  useWorkflowRunHistory,
} from "@proliferate/cloud-sdk-react";
import {
  createManagedWorkflowLaunchAttempt,
  createWorkflowArgumentDraft,
  normalizeWorkflowArguments,
  referencedWorkflowInputNames,
  type ManagedWorkflowLaunchAttempt,
  type WorkflowArgumentIssue,
} from "@proliferate/product-domain/workflows/arguments";
import type { WorkflowDefinition } from "@proliferate/product-domain/workflows/definition";
import {
  safeWorkflowFailureCopy,
  workflowRunPresentation,
} from "@proliferate/product-domain/workflows/run-presentation";
import { WorkflowRunDetail } from "@proliferate/product-ui/workflows/WorkflowRunDetail";
import { WorkflowRunForm } from "@proliferate/product-ui/workflows/WorkflowRunForm";
import { WorkflowRunList } from "@proliferate/product-ui/workflows/WorkflowRunList";
import { WorkflowResourceState } from "./WorkflowResourceState";

const OPERATION_TIMEOUT_MS = 15_000;

export interface WorkflowRunOpenResult {
  opened: boolean;
  message?: string;
}

export interface WorkflowDefinitionRunsPanelProps {
  authCacheScope: string;
  definition: WorkflowDefinition;
  managedRunsEnabled: boolean;
  onOpenRun: (runId: string) => void;
}

export function WorkflowDefinitionRunsPanel({
  authCacheScope,
  definition,
  managedRunsEnabled,
  onOpenRun,
}: WorkflowDefinitionRunsPanelProps) {
  const eligibility = useWorkflowRunEligibility(
    definition.id,
    definition.revision,
    authCacheScope,
  );
  const history = useWorkflowRunHistory(definition.id, authCacheScope);
  const actions = useWorkflowRunActions(authCacheScope);
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
  const runs = useMemo(() => {
    const unique = new Map<string, NonNullable<typeof history.data>["pages"][number]["items"][number]>();
    for (const page of history.data?.pages ?? []) {
      for (const item of page.items) {
        if (!unique.has(item.id)) unique.set(item.id, item);
      }
    }
    return [...unique.values()];
  }, [history.data]);

  const executeAttempt = async (
    current: ManagedWorkflowLaunchAttempt,
    lockAlreadyHeld = false,
  ) => {
    if (!lockAlreadyHeld && launchInFlight.current) return;
    if (!lockAlreadyHeld) launchInFlight.current = true;
    setBusy(true);
    setError(null);
    setAttemptMessage(null);
    try {
      await withTimeout((signal) => actions.putWorkflowInvocation({
        invocationId: current.invocationId,
        body: current.request,
        signal,
      }));
      const delivered = await withTimeout((signal) => actions.deliverWorkflowInvocation({
        invocationId: current.invocationId,
        signal,
      }));
      setAttempt(null);
      onOpenRun(delivered.id);
    } catch (caught) {
      setAttempt(current);
      setAttemptMessage("This launch may already exist. Check or retry the same run identity.");
      setError(safeActionError(caught));
    } finally {
      if (!lockAlreadyHeld) launchInFlight.current = false;
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
    ) return;
    const normalized = normalizeWorkflowArguments(
      definition.inputs,
      prompt,
      currentArguments.draft,
    );
    setArgumentState({ ...currentArguments, issues: normalized.issues });
    if (normalized.issues.length > 0) return;
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
    if (!attempt || launchInFlight.current) return;
    launchInFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const existing = await withTimeout((signal) => actions.checkWorkflowInvocation({
        invocationId: attempt.invocationId,
        signal,
      }));
      if (existing.managedExecution.deliveryStatus === "prepared") {
        const delivered = await withTimeout((signal) => actions.deliverWorkflowInvocation({
          invocationId: attempt.invocationId,
          signal,
        }));
        setAttempt(null);
        onOpenRun(delivered.id);
      } else {
        setAttempt(null);
        onOpenRun(existing.id);
      }
    } catch (caught) {
      if (workflowCloudError(caught)?.status === 404) {
        await executeAttempt(attempt, true);
        return;
      }
      setError(safeActionError(caught));
    } finally {
      launchInFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 space-y-4">
      <WorkflowRunForm
        inputs={definition.inputs}
        draft={currentArguments.draft}
        issues={currentArguments.issues}
        blockers={eligibility.data?.blockers ?? []}
        requiredForRunInputNames={referencedWorkflowInputNames(prompt)}
        capabilityEnabled={managedRunsEnabled}
        launchBlocked={eligibility.isError || history.isError || attempt !== null}
        submitting={busy || eligibility.isLoading || history.isLoading}
        serverError={eligibility.isError
          ? "Run eligibility could not be loaded."
          : history.isError
            ? "Recent run history must load before starting another run."
            : error}
        attemptMessage={attemptMessage}
        onChange={(next) => {
          setArgumentState({ definitionKey, draft: next, issues: [] });
        }}
        onSubmit={submit}
        onRetryAttempt={attempt ? () => void recover() : undefined}
      />
      <WorkflowRunList
        runs={runs}
        loading={history.isLoading}
        error={history.isError ? "Run history could not be loaded." : null}
        hasMore={history.hasNextPage}
        loadingMore={history.isFetchingNextPage}
        onSelect={onOpenRun}
        onLoadMore={() => void history.fetchNextPage()}
        onRetry={() => void history.refetch()}
      />
    </div>
  );
}

export interface WorkflowRunsSurfaceProps {
  authCacheScope: string;
  workflowDefinitionId: string;
  runId: string;
  managedRunsEnabled: boolean;
  onBack: () => void;
  onOpenSession: (target: ManagedWorkflowOpenTarget) => Promise<WorkflowRunOpenResult>;
}

export function WorkflowRunsSurface({
  authCacheScope,
  workflowDefinitionId,
  runId,
  managedRunsEnabled,
  onBack,
  onOpenSession,
}: WorkflowRunsSurfaceProps) {
  const [targetLostInvocationId, setTargetLostInvocationId] = useState<string | null>(null);
  const targetLostByCancel = targetLostInvocationId === runId;
  const query = useWorkflowRun(
    workflowDefinitionId,
    runId,
    authCacheScope,
    !targetLostByCancel,
  );
  const actions = useWorkflowRunActions(authCacheScope);
  const [actionError, setActionError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = targetLostByCancel && query.data
    ? projectTargetLost(query.data)
    : query.data;

  if (query.isLoading) {
    return <WorkflowResourceState loading title="Loading run" description="Loading the current managed status." onBack={onBack} />;
  }
  const queryError = workflowCloudError(query.error);
  if (queryError?.status === 404) {
    return (
      <WorkflowResourceState
        title="Run not found"
        description="It may have been deleted or you may not have access."
        onBack={onBack}
        onRetry={() => void query.refetch()}
      />
    );
  }
  if (!run) {
    return (
      <WorkflowResourceState
        title="Run unavailable"
        description="The current managed status could not be loaded. Try again."
        onBack={onBack}
        onRetry={() => void query.refetch()}
      />
    );
  }
  if (run.workflowDefinitionId !== workflowDefinitionId) {
    return (
      <WorkflowResourceState
        title="Run not found"
        description="It may have been deleted or you may not have access."
        onBack={onBack}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const presentation = workflowRunPresentation(run);
  const perform = async (operation: "deliver" | "cancel") => {
    setBusy(true);
    setActionError(null);
    try {
      if (operation === "deliver") {
        await withTimeout((signal) => actions.deliverWorkflowInvocation({ invocationId: run.id, signal }));
      } else {
        await withTimeout((signal) => actions.cancelWorkflowInvocation({ invocationId: run.id, signal }));
      }
    } catch (caught) {
      const cloudError = workflowCloudError(caught);
      if (
        operation === "cancel"
        && cloudError?.status === 409
        && cloudError.code === "workflow_target_lost"
      ) {
        setTargetLostInvocationId(run.id);
        setActionError("The managed target was replaced. The final outcome is unknown.");
        await query.refetch();
      } else {
        setActionError(safeActionError(caught));
      }
    } finally {
      setBusy(false);
    }
  };

  const open = async () => {
    const target = run.managedExecution.openTarget;
    if (!target) return;
    setBusy(true);
    setOpenError(null);
    try {
      const result = await onOpenSession(target);
      if (!result.opened) {
        setOpenError(result.message ?? "This workflow session is no longer available.");
      }
    } catch {
      setOpenError("This workflow session is no longer available.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <WorkflowRunDetail
      run={run}
      presentation={presentation}
      deliveryCapabilityEnabled={managedRunsEnabled}
      busy={busy}
      actionError={actionError ?? (query.isError
        ? "The latest status could not be refreshed. The last known state is shown."
        : null)}
      openSessionUnavailable={openError}
      onBack={onBack}
      onRefresh={() => void query.refetch()}
      onStartDelivery={() => void perform("deliver")}
      onCancel={() => void perform("cancel")}
      onOpenSession={() => void open()}
    />
  );
}

function projectTargetLost(
  run: ManagedWorkflowInvocationResponse,
): ManagedWorkflowInvocationResponse {
  return {
    ...run,
    managedExecution: {
      ...run.managedExecution,
      freshness: { ...run.managedExecution.freshness, status: "target_lost" },
    },
  };
}

async function withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPERATION_TIMEOUT_MS);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

function safeActionError(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "The request timed out. Its durable status may still have changed.";
  }
  const cloudError = workflowCloudError(error);
  if (cloudError) {
    return safeWorkflowFailureCopy(cloudError.code)
      ?? "The workflow request could not be completed. Refresh for the latest status.";
  }
  return "The workflow request could not be completed. Refresh for the latest status.";
}

function workflowCloudError(error: unknown): { status: number; code: string | null } | null {
  if (!error || typeof error !== "object") return null;
  const status = "status" in error ? error.status : null;
  const code = "code" in error ? error.code : null;
  if (typeof status !== "number" || (code !== null && typeof code !== "string")) return null;
  return { status, code };
}
