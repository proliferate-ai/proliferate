import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createEmptyDefinition,
  serializeWorkflowDefinition,
  type WorkflowDefinition,
  type WorkflowSetup,
} from "@proliferate/product-domain/workflows/definition";
import {
  buildWorkflowRunRow,
  freePlanWorkflowLimit,
  workflowCreateAllowed,
} from "@proliferate/product-domain/workflows/model";
import {
  coerceRunStatus,
  workflowRunStatusTone,
  type WorkflowStatusTone,
} from "@proliferate/product-domain/workflows/run-status";
import type { WorkflowTemplate } from "@proliferate/product-domain/workflows/templates";
import { ProliferateClientError } from "@/lib/access/cloud/client";
import { MainSidebarPageShell } from "@/components/workspace/shell/screen/MainSidebarPageShell";
import { ProductPageShell } from "@proliferate/product-ui/layout/ProductPageShell";
import { EmptyState } from "@proliferate/ui/layout/EmptyState";
import { Button } from "@proliferate/ui/primitives/Button";
import { Plus } from "@proliferate/ui/icons";
import { useCloudAgentCatalog } from "@/hooks/access/cloud/agent-catalog/use-cloud-agent-catalog";
import { useWorkflows, useWorkflowRuns } from "@/hooks/access/cloud/workflows/use-workflows";
import { useWorkflowMutations } from "@/hooks/access/cloud/workflows/use-workflow-mutations";
import { useLaunchWorkflowRun } from "@/hooks/access/cloud/workflows/use-launch-workflow-run";
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

function defaultSetupFromCatalog(agents: readonly DesktopCatalogAgent[] | undefined): WorkflowSetup {
  const agent = agents?.[0];
  return {
    harness: agent?.kind ?? "claude",
    model: agent?.defaultModelId ?? agent?.models[0]?.id ?? "sonnet",
    sessionBinding: "fresh",
  };
}

function withDefaultSetup(
  definition: WorkflowDefinition,
  agents: readonly DesktopCatalogAgent[] | undefined,
): WorkflowDefinition {
  const agent = agents?.[0];
  if (!agent) {
    return definition;
  }
  return {
    ...definition,
    setup: {
      ...definition.setup,
      harness: agent.kind,
      model: agent.defaultModelId ?? agent.models[0]?.id ?? definition.setup.model,
    },
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

  const workflowsQuery = useWorkflows();
  const runsQuery = useWorkflowRuns(null);
  const catalogQuery = useCloudAgentCatalog();
  const workspacesQuery = useWorkspaces();
  const cloudTargetsQuery = useCloudRunTargetWorkspaces();
  const { createMutation } = useWorkflowMutations();
  const launchMutation = useLaunchWorkflowRun();

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
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          costUsd: run.costUsd,
          costTokens: run.costTokens,
        }),
      ),
    [runs, nameById],
  );

  const canCreate = workflowCreateAllowed(workflows.length, freePlanWorkflowLimit());

  const runNow = (workflowId: string, submit: WorkflowRunSubmit) => {
    setRunError(null);
    setRunErrorCode(null);
    launchMutation.mutate(
      {
        workflowId,
        args: submit.args,
        targetMode: submit.targetMode,
        localWorkspaceId: submit.localWorkspaceId,
        cloudWorkspaceId: submit.cloudWorkspaceId,
      },
      {
        onSuccess: (run) => {
          setArgsModal(null);
          navigate(`/workflows/${workflowId}/runs/${run.id}`);
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
    createAndEdit("Untitled workflow", null, createEmptyDefinition(defaultSetupFromCatalog(agents)));

  const useTemplate = (template: WorkflowTemplate) =>
    createAndEdit(template.name, template.description, withDefaultSetup(template.definition, agents));

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
                <Button size="sm" onClick={startFromScratch} disabled={!canCreate || createMutation.isPending}>
                  <Plus className="size-3.5" />
                  New
                </Button>
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
        <WorkflowRunArgsModal
          open
          workflowName={argsModal.workflow.name}
          args={argsModal.definition.args}
          localWorkspaces={localWorkspaceOptions}
          cloudWorkspaces={cloudWorkspaceOptions}
          hasIntegrations={argsModal.definition.integrations.length > 0}
          busy={launchMutation.isPending}
          error={runError}
          onOpenIntegrationsSettings={
            runErrorCode === FUNCTION_PROVIDER_NOT_READY_CODE
              ? () => navigate("/settings?section=integrations")
              : undefined
          }
          onClose={() => setArgsModal(null)}
          onSubmit={(submit) => runNow(argsModal.workflow.id, submit)}
        />
      ) : null}
    </MainSidebarPageShell>
  );
}
