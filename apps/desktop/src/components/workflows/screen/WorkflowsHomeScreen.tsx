import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createEmptyDefinition,
  isParallelGroup,
  serializeWorkflowDefinition,
  spineAgentNodes,
  type WorkflowAgentNode,
  type WorkflowDefinition,
} from "@proliferate/product-domain/workflows/definition";
import {
  buildWorkflowRunRow,
  freePlanWorkflowLimit,
  workflowCreateAllowed,
  type WorkflowTargetMode,
} from "@proliferate/product-domain/workflows/model";
import {
  coerceRunStatus,
  workflowRunStatusTone,
  type WorkflowStatusTone,
} from "@proliferate/product-domain/workflows/run-status";
import {
  deriveLastUsedTarget,
  type WorkflowRunTargetRecord,
} from "@proliferate/product-domain/workflows/run-launch";
import type { WorkflowTemplate } from "@proliferate/product-domain/workflows/templates";
import { deriveWorkflowInputsFromPollSample } from "@proliferate/product-domain/workflows/poll-setup";
import { ProliferateClientError } from "@proliferate/cloud-sdk";
import { useWorkflowRunPillStore } from "@/stores/workflows/workflow-run-pill-store";
import { MainSidebarPageShell } from "@/components/workspace/shell/screen/MainSidebarPageShell";
import { ProductPageShell } from "@proliferate/product-ui/layout/ProductPageShell";
import { EmptyState } from "@proliferate/ui/layout/EmptyState";
import { Button } from "@proliferate/ui/primitives/Button";
import { Plus, RefreshCw } from "@proliferate/ui/icons";
import { useCloudAgentCatalog } from "@/hooks/access/cloud/agent-catalog/use-cloud-agent-catalog";
import { useWorkflows, useWorkflowRuns } from "@/hooks/access/cloud/workflows/use-workflows";
import { useWorkflowMutations } from "@/hooks/access/cloud/workflows/use-workflow-mutations";
import { useLaunchWorkflowRun } from "@/hooks/access/cloud/workflows/use-launch-workflow-run";
import { useInspectPollEndpoint } from "@/hooks/access/cloud/workflows/use-inspect-poll-endpoint";
import { useCloudRunTargetWorkspaces } from "@/hooks/access/cloud/workspaces/use-cloud-run-target-workspaces";
import { useWorkspaces } from "@/hooks/workspaces/cache/use-workspaces";
import type { WorkflowResponse } from "@/hooks/access/cloud/workflows/types";
import { WorkflowCardContainer } from "../home/WorkflowCardContainer";
import { WorkflowRunsTable } from "../home/WorkflowRunsTable";
import {
  WorkflowRunArgsModal,
  type WorkflowRunSubmit,
  type WorkflowRunTargetOption,
} from "../home/WorkflowRunArgsModal";
import { WorkflowTemplatesGallery } from "../home/WorkflowTemplatesGallery";
import {
  WorkflowPollInspectModal,
  type WorkflowPollInspectSubmit,
} from "../home/WorkflowPollInspectModal";
import type { PollInspectResponse } from "@/hooks/access/cloud/workflows/types";

type HomeTab = "workflows" | "runs";

// Mirrors gateway_grants.py's L22 fail-fast code — a declared function
// provider with no ready account for the owner. StartRun never silently
// narrows the grant, so this always means "connect the named provider".
const FUNCTION_PROVIDER_NOT_READY_CODE = "workflow_function_provider_not_ready";

interface DesktopCatalogAgent {
  kind: string;
  defaultModelId: string | null;
  models: { id: string }[];
}

function defaultNodeFromCatalog(agents: readonly DesktopCatalogAgent[] | undefined): WorkflowAgentNode {
  const agent = agents?.[0];
  return {
    slot: "main",
    harness: agent?.kind ?? "claude",
    model: agent?.defaultModelId ?? agent?.models[0]?.id ?? "sonnet",
    steps: [],
  };
}

/** Re-default the template's first agent node to the owner's first catalog agent. */
function withDefaultAgent(
  definition: WorkflowDefinition,
  agents: readonly DesktopCatalogAgent[] | undefined,
): WorkflowDefinition {
  const agent = agents?.[0];
  const [first, ...rest] = definition.agents;
  // Seed templates are single-node; a parallel-group first entry is left as-is
  // (re-defaulting a group's harness/model is the editor phase's concern).
  if (!agent || !first || isParallelGroup(first)) {
    return definition;
  }
  return {
    ...definition,
    agents: [
      { ...first, harness: agent.kind, model: agent.defaultModelId ?? agent.models[0]?.id ?? first.model },
      ...rest,
    ],
  };
}

function relativeTime(iso: string | null): string {
  if (!iso) {
    return "";
  }
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    return "";
  }
  const deltaSec = Math.round((Date.now() - ms) / 1000);
  if (deltaSec < 60) {
    return "just now";
  }
  if (deltaSec < 3600) {
    return `${Math.floor(deltaSec / 60)}m ago`;
  }
  if (deltaSec < 86_400) {
    return `${Math.floor(deltaSec / 3600)}h ago`;
  }
  return `${Math.floor(deltaSec / 86_400)}d ago`;
}

function TabToggle({ tab, onChange }: { tab: HomeTab; onChange: (tab: HomeTab) => void }) {
  const options: { value: HomeTab; label: string }[] = [
    { value: "workflows", label: "Workflows" },
    { value: "runs", label: "Runs" },
  ];
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-foreground/[0.02] p-0.5">
      {options.map((option) => (
        <Button
          key={option.value}
          variant="unstyled"
          onClick={() => onChange(option.value)}
          className={`rounded-md px-3 py-1 text-ui-sm ${
            tab === option.value
              ? "bg-background font-medium text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

export function WorkflowsHomeScreen() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<HomeTab>("workflows");
  const [argsModal, setArgsModal] = useState<{
    workflow: WorkflowResponse;
    definition: WorkflowDefinition;
  } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [runErrorCode, setRunErrorCode] = useState<string | null>(null);
  const [pollModalOpen, setPollModalOpen] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const [pollResult, setPollResult] = useState<PollInspectResponse | null>(null);

  const workflowsQuery = useWorkflows();
  const runsQuery = useWorkflowRuns(null);
  const catalogQuery = useCloudAgentCatalog();
  const workspacesQuery = useWorkspaces();
  const cloudTargetsQuery = useCloudRunTargetWorkspaces();
  const { createMutation } = useWorkflowMutations();
  const launchMutation = useLaunchWorkflowRun();
  const showRunPill = useWorkflowRunPillStore((state) => state.show);
  const inspectPollMutation = useInspectPollEndpoint();

  const workflows = workflowsQuery.data?.workflows ?? [];
  const runs = runsQuery.data?.runs ?? [];
  const agents = catalogQuery.data?.agents as DesktopCatalogAgent[] | undefined;

  const localWorkspaceOptions = useMemo<WorkflowRunTargetOption[]>(
    () =>
      (workspacesQuery.data?.localWorkspaces ?? []).map((workspace) => ({
        id: workspace.id,
        label: workspace.displayName || workspace.currentBranch || workspace.path,
      })),
    [workspacesQuery.data],
  );
  const cloudWorkspaceOptions = useMemo<WorkflowRunTargetOption[]>(
    () =>
      (cloudTargetsQuery.data ?? [])
        .filter((workspace) => workspace.status === "ready")
        .map((workspace) => ({
          id: workspace.id,
          label: workspace.displayName ?? workspace.repo.branch,
        })),
    [cloudTargetsQuery.data],
  );

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const workflow of workflows) {
      map.set(workflow.id, workflow.name);
    }
    return map;
  }, [workflows]);

  const lastRunByWorkflow = useMemo(() => {
    const map = new Map<string, { atLabel: string; tone: WorkflowStatusTone; status: string }>();
    for (const run of runs) {
      const existing = map.get(run.workflowId);
      const atLabel = relativeTime(run.startedAt ?? run.createdAt);
      if (!existing) {
        map.set(run.workflowId, {
          atLabel: atLabel || "recently",
          tone: workflowRunStatusTone(coerceRunStatus(run.status)),
          status: run.status,
        });
      }
    }
    return map;
  }, [runs]);

  const runRows = useMemo(
    () =>
      runs.map((run) =>
        buildWorkflowRunRow({
          id: run.id,
          workflowId: run.workflowId,
          workflowName: nameById.get(run.workflowId) ?? null,
          triggerKind: run.triggerKind,
          status: run.status,
          errorCode: run.errorCode,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          costUsd: run.costUsd,
          costTokens: run.costTokens,
        }),
      ),
    [runs, nameById],
  );

  // Seeds (starter templates) are org-agnostic and don't count against the
  // owner's free-plan slot — the server counts only owned rows, so the client
  // must match or "New" is wrongly disabled when only seeds are present.
  const ownedWorkflowCount = workflows.filter((workflow) => !workflow.isSeed).length;
  const canCreate = workflowCreateAllowed(ownedWorkflowCount, freePlanWorkflowLimit());

  // R6: run rows already store the target they ran in — derive the last-used
  // workspace per workflow to pre-fill the modal (no new stored shape).
  const runTargetRecords = useMemo<WorkflowRunTargetRecord[]>(
    () =>
      runs.map((run) => ({
        workflowId: run.workflowId,
        createdAt: run.startedAt ?? run.createdAt,
        targetMode: (run.targetMode as WorkflowTargetMode) ?? "local",
        workspaceId: run.anyharnessWorkspaceId,
      })),
    [runs],
  );

  const runNow = (workflow: WorkflowResponse, submit: WorkflowRunSubmit) => {
    setRunError(null);
    setRunErrorCode(null);
    launchMutation.mutate(
      {
        workflowId: workflow.id,
        args: submit.args,
        targetMode: submit.targetMode,
        localWorkspaceId: submit.localWorkspaceId,
        cloudWorkspaceId: submit.cloudWorkspaceId,
        sessionBindings: submit.sessionBindings,
      },
      {
        onSuccess: (run) => {
          // R2: stay put — drop a run pill instead of navigating away.
          setArgsModal(null);
          showRunPill({ runId: run.id, workflowId: workflow.id, workflowName: workflow.name });
        },
        onError: (error) => {
          setRunError(error.message);
          setRunErrorCode(error instanceof ProliferateClientError ? error.code : null);
        },
      },
    );
  };

  // Always open the modal: even an arg-less workflow needs a run target (spec 3.2).
  const handleRun = (workflow: WorkflowResponse, definition: WorkflowDefinition) => {
    setRunError(null);
    setRunErrorCode(null);
    setArgsModal({ workflow, definition });
  };

  const createAndEdit = (name: string, description: string | null, definition: WorkflowDefinition) => {
    createMutation.mutate(
      {
        name,
        description: description ?? undefined,
        definition: serializeWorkflowDefinition(definition),
      },
      { onSuccess: (detail) => navigate(`/workflows/${detail.workflow.id}/edit`) },
    );
  };

  const startFromScratch = () =>
    createAndEdit("Untitled workflow", null, createEmptyDefinition(defaultNodeFromCatalog(agents)));

  const useTemplate = (template: WorkflowTemplate) =>
    createAndEdit(template.name, template.description, withDefaultAgent(template.definition, agents));

  // Flow 1 (workflow-from-poll, mental-model §5): probe /init, derive a starting
  // `inputs` skeleton from the sample, then hand off into the editor exactly like
  // any other creation path (`createAndEdit`) — a bad /init is a hard error shown
  // in the modal, nothing is created.
  const openPollModal = () => {
    setPollError(null);
    setPollResult(null);
    setPollModalOpen(true);
  };

  const closePollModal = () => {
    setPollModalOpen(false);
    setPollError(null);
    setPollResult(null);
  };

  // Phase 1: probe /init and hold the result so the modal can review it (derived
  // inputs + any sample fields that couldn't become inputs) before hand-off.
  const startFromPoll = (submit: WorkflowPollInspectSubmit) => {
    setPollError(null);
    inspectPollMutation.mutate(
      { url: submit.url, authHeader: submit.authHeader, authValue: submit.authValue },
      {
        onSuccess: (result) => setPollResult(result),
        onError: (error) => setPollError(error.message),
      },
    );
  };

  // Phase 2: seed a new definition with the derived inputs and hand off into the
  // editor exactly like any other creation path (`createAndEdit`).
  const confirmFromPoll = () => {
    if (!pollResult) return;
    const inputs = deriveWorkflowInputsFromPollSample(pollResult.derivedInputs);
    const definition = {
      ...createEmptyDefinition(defaultNodeFromCatalog(agents)),
      inputs,
    };
    closePollModal();
    createAndEdit("Untitled workflow", null, definition);
  };

  const showEmptyGallery = tab === "workflows" && !workflowsQuery.isLoading && workflows.length === 0;

  return (
    <MainSidebarPageShell>
      <div className="mx-auto flex h-full w-full min-w-0 max-w-4xl flex-col px-8 pt-10">
        <ProductPageShell
          title="Workflows"
          description="Deterministic programs your agents run — manual today, scheduled soon."
          actions={
            <div className="flex items-center gap-2">
              <TabToggle tab={tab} onChange={setTab} />
              {tab === "workflows" && workflows.length > 0 ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={openPollModal}
                    disabled={!canCreate || createMutation.isPending}
                  >
                    <RefreshCw className="size-3.5" />
                    From a poll feed
                  </Button>
                  <Button size="sm" onClick={startFromScratch} disabled={!canCreate || createMutation.isPending}>
                    <Plus className="size-3.5" />
                    New
                  </Button>
                </>
              ) : null}
            </div>
          }
        >
          {runError ? (
            <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-ui-sm text-destructive">
              {runError}
            </p>
          ) : null}

          {workflowsQuery.isError ? (
            <EmptyState
              title="Couldn't load workflows"
              description="Check your connection and try again."
              action={
                <Button size="sm" onClick={() => void workflowsQuery.refetch()}>
                  Retry
                </Button>
              }
            />
          ) : tab === "runs" ? (
            <WorkflowRunsTable
              rows={runRows}
              loading={runsQuery.isLoading}
              onRunSelect={(runId) => {
                const run = runs.find((item) => item.id === runId);
                if (run) {
                  navigate(`/workflows/${run.workflowId}/runs/${runId}`);
                }
              }}
            />
          ) : showEmptyGallery ? (
            <WorkflowTemplatesGallery
              busy={createMutation.isPending}
              onUseTemplate={useTemplate}
              onStartFromScratch={startFromScratch}
              onStartFromPoll={openPollModal}
            />
          ) : (
            <>
              {!canCreate ? (
                <p className="mb-4 text-ui-sm text-faint">
                  Free plan: one workflow. Archive this one to create another.
                </p>
              ) : null}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {workflows.map((workflow) => {
                  const last = lastRunByWorkflow.get(workflow.id);
                  return (
                    <WorkflowCardContainer
                      key={workflow.id}
                      workflow={workflow}
                      lastRun={last ? { status: last.status, atLabel: last.atLabel } : null}
                      lastRunTone={last?.tone ?? "muted"}
                      runBusy={launchMutation.isPending && argsModal === null}
                      onOpen={(workflowId) => navigate(`/workflows/${workflowId}/edit`)}
                      onRun={handleRun}
                    />
                  );
                })}
              </div>
            </>
          )}
        </ProductPageShell>
      </div>

      {argsModal ? (
        (() => {
          const lastUsed = deriveLastUsedTarget(runTargetRecords, argsModal.workflow.id);
          return (
            <WorkflowRunArgsModal
              open
              workflowName={argsModal.workflow.name}
              args={argsModal.definition.inputs}
              slots={spineAgentNodes(argsModal.definition).map((agent) => ({
                slot: agent.slot,
                harness: agent.harness,
                model: agent.model,
              }))}
              localWorkspaces={localWorkspaceOptions}
              cloudWorkspaces={cloudWorkspaceOptions}
              defaultTargetMode={lastUsed?.targetMode ?? null}
              defaultLocalWorkspaceId={
                lastUsed?.targetMode === "local" ? lastUsed.workspaceId : null
              }
              defaultCloudWorkspaceId={
                lastUsed?.targetMode === "personal_cloud" ? lastUsed.workspaceId : null
              }
              hasIntegrations={argsModal.definition.integrations.length > 0}
              busy={launchMutation.isPending}
              error={runError}
              onOpenIntegrationsSettings={
                runErrorCode === FUNCTION_PROVIDER_NOT_READY_CODE
                  ? () => navigate("/settings?section=integrations")
                  : undefined
              }
              onClose={() => setArgsModal(null)}
              onSubmit={(submit) => runNow(argsModal.workflow, submit)}
            />
          );
        })()
      ) : null}

      <WorkflowPollInspectModal
        open={pollModalOpen}
        busy={inspectPollMutation.isPending || createMutation.isPending}
        error={pollError}
        review={
          pollResult
            ? {
                derivedCount: pollResult.derivedInputs.length,
                skippedFields: pollResult.skippedFields,
              }
            : null
        }
        onClose={closePollModal}
        onSubmit={startFromPoll}
        onConfirm={confirmFromPoll}
      />
    </MainSidebarPageShell>
  );
}
