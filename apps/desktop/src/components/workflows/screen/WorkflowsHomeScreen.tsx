import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  spineAgentNodes,
  type WorkflowDefinition,
} from "@proliferate/product-domain/workflows/definition";
import {
  freePlanWorkflowLimit,
  workflowCreateAllowed,
  type WorkflowTargetMode,
} from "@proliferate/product-domain/workflows/model";
import {
  deriveLastUsedTarget,
  type WorkflowRunTargetRecord,
} from "@proliferate/product-domain/workflows/run-launch";
import { ProliferateClientError } from "@proliferate/cloud-sdk";
import { useWorkflowRunPillStore } from "@/stores/workflows/workflow-run-pill-store";
import { MainSidebarPageShell } from "@/components/workspace/shell/screen/MainSidebarPageShell";
import { ProductPageShell } from "@proliferate/product-ui/layout/ProductPageShell";
import { EmptyState } from "@proliferate/ui/layout/EmptyState";
import { Button } from "@proliferate/ui/primitives/Button";
import { ArrowLeft, Play, Pencil, Plus, RefreshCw } from "@proliferate/ui/icons";
import { useWorkflows, useWorkflowRuns } from "@/hooks/access/cloud/workflows/use-workflows";
import { useWorkflowMutations } from "@/hooks/access/cloud/workflows/use-workflow-mutations";
import { useLaunchWorkflowRun } from "@/hooks/access/cloud/workflows/use-launch-workflow-run";
import { useWorkflowDefinitionFetch } from "@/hooks/access/cloud/workflows/use-workflow-definition-fetch";
import { useCloudRunTargetWorkspaces } from "@/hooks/access/cloud/workspaces/use-cloud-run-target-workspaces";
import { useWorkspaces } from "@/hooks/workspaces/cache/use-workspaces";
import { useWorkflowCreateFlows } from "@/hooks/workflows/workflows/use-workflow-create-flows";
import type { WorkflowResponse, WorkflowRunResponse } from "@/hooks/access/cloud/workflows/types";
import type { RunStatusFilter, TargetFilter } from "@/hooks/workflows/derived/workflow-run-row-view";
import { WorkflowListView } from "../home/WorkflowListView";
import { WorkflowRunsDrillIn } from "../home/WorkflowRunsDrillIn";
import {
  WorkflowRunArgsModal,
  type WorkflowRunSubmit,
  type WorkflowRunTargetOption,
} from "../home/WorkflowRunArgsModal";
import { WorkflowTemplatesGallery } from "../home/WorkflowTemplatesGallery";
import { WorkflowPollInspectModal } from "../home/WorkflowPollInspectModal";

// Mirrors gateway_grants.py's L22 fail-fast code — a declared function
// provider with no ready account for the owner. StartRun never silently
// narrows the grant, so this always means "connect the named provider".
const FUNCTION_PROVIDER_NOT_READY_CODE = "workflow_function_provider_not_ready";

export function WorkflowsHomeScreen() {
  const navigate = useNavigate();
  // Drill-in: the list page is the org's workflows; opening one shows its runs
  // (newest first) — one navigation model, no separate run-list tab.
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [targetFilter, setTargetFilter] = useState<TargetFilter>("all");
  const [runFilter, setRunFilter] = useState<RunStatusFilter>("all");
  const [argsModal, setArgsModal] = useState<{
    workflow: WorkflowResponse;
    definition: WorkflowDefinition;
  } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [runErrorCode, setRunErrorCode] = useState<string | null>(null);

  const workflowsQuery = useWorkflows();
  const runsQuery = useWorkflowRuns(null);
  const workspacesQuery = useWorkspaces();
  const cloudTargetsQuery = useCloudRunTargetWorkspaces();
  const { archiveMutation } = useWorkflowMutations();
  const launchMutation = useLaunchWorkflowRun();
  const showRunPill = useWorkflowRunPillStore((state) => state.show);
  const { fetchDefinition } = useWorkflowDefinitionFetch();
  const createFlows = useWorkflowCreateFlows();

  const workflows = workflowsQuery.data?.workflows ?? [];
  const runs = runsQuery.data?.runs ?? [];

  const open = openId ? workflows.find((wf) => wf.id === openId) ?? null : null;

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

  // Newest run per workflow (runs arrive newest-first from the server).
  const lastRunByWorkflow = useMemo(() => {
    const map = new Map<string, WorkflowRunResponse>();
    for (const run of runs) {
      if (!map.has(run.workflowId)) {
        map.set(run.workflowId, run);
      }
    }
    return map;
  }, [runs]);

  // Seeds (starter templates) are org-agnostic and don't count against the
  // owner's free-plan slot — the server counts only owned rows, so the client
  // must match or "New" is wrongly disabled when only seeds are present.
  const ownedWorkflowCount = workflows.filter((workflow) => !workflow.isSeed).length;
  const canCreate = workflowCreateAllowed(ownedWorkflowCount, freePlanWorkflowLimit());

  const filteredWorkflows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return workflows.filter((wf) => {
      if (targetFilter !== "all") {
        const lastMode = lastRunByWorkflow.get(wf.id)?.targetMode;
        const target = lastMode === "personal_cloud" ? "cloud" : lastMode === "local" ? "local" : null;
        // A never-run workflow has no target fact yet — show it under All only.
        if (target !== targetFilter) {
          return false;
        }
      }
      if (!q) {
        return true;
      }
      return (
        wf.name.toLowerCase().includes(q) ||
        (wf.description ?? "").toLowerCase().includes(q)
      );
    });
  }, [workflows, query, targetFilter, lastRunByWorkflow]);

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

  /** Drill-in Run button: fetch the workflow's current definition (cached by
   * the row container's detail query in the common path) and open the shared
   * launch modal — same modal, same submit path as the row Run buttons. */
  const navigateToRunModal = async (workflow: WorkflowResponse) => {
    setRunError(null);
    setRunErrorCode(null);
    try {
      const definition = await fetchDefinition(workflow.id);
      if (definition) {
        handleRun(workflow, definition);
      }
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error));
    }
  };

  const showEmptyGallery = !open && !workflowsQuery.isLoading && workflows.length === 0;

  return (
    <MainSidebarPageShell>
      <div className="mx-auto flex h-full w-full min-w-0 max-w-4xl flex-col px-8 pt-10">
        <ProductPageShell
          title={
            open ? (
              <span className="flex min-w-0 items-center gap-3">
                <Button
                  type="button"
                  variant="unstyled"
                  size="unstyled"
                  onClick={() => setOpenId(null)}
                  className="inline-flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="size-3.5" />
                  Workflows
                </Button>
                <span aria-hidden className="text-faint">/</span>
                <span className="truncate">{open.name}</span>
              </span>
            ) : (
              "Workflows"
            )
          }
          description={open ? open.description ?? undefined : "Deterministic programs your agents run."}
          actions={
            open ? (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => navigate(`/workflows/${open.id}/edit`)}>
                  <Pencil className="size-3.5" />
                  {open.isSeed ? "View" : "Edit"}
                </Button>
                <Button size="sm" onClick={() => void navigateToRunModal(open)}>
                  <Play className="size-3.5" />
                  Run
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {workflows.length > 0 ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={createFlows.openPollModal}
                      disabled={!canCreate || createFlows.isCreating}
                    >
                      <RefreshCw className="size-3.5" />
                      From a poll feed
                    </Button>
                    <Button size="sm" onClick={createFlows.startFromScratch} disabled={!canCreate || createFlows.isCreating}>
                      <Plus className="size-3.5" />
                      New
                    </Button>
                  </>
                ) : null}
              </div>
            )
          }
        >
          {runError ? (
            <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-ui-sm text-destructive">
              {runError}
            </p>
          ) : null}
          {createFlows.createError ? (
            <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-ui-sm text-destructive">
              {createFlows.createError}
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
          ) : showEmptyGallery ? (
            <WorkflowTemplatesGallery
              busy={createFlows.isCreating}
              onUseTemplate={createFlows.useTemplate}
              onStartFromScratch={createFlows.startFromScratch}
              onStartFromPoll={createFlows.openPollModal}
            />
          ) : open ? (
            <WorkflowRunsDrillIn
              workflow={open}
              runs={runs}
              runFilter={runFilter}
              onRunFilterChange={setRunFilter}
              onOpenRun={(runId) => navigate(`/workflows/${open.id}/runs/${runId}`)}
            />
          ) : (
            <WorkflowListView
              workflows={filteredWorkflows}
              canCreate={canCreate}
              query={query}
              onQueryChange={setQuery}
              targetFilter={targetFilter}
              onTargetFilterChange={setTargetFilter}
              lastRunByWorkflow={lastRunByWorkflow}
              onOpen={setOpenId}
              onRun={handleRun}
              onEdit={(workflowId) => navigate(`/workflows/${workflowId}/edit`)}
              onArchive={(workflowId) => archiveMutation.mutate(workflowId)}
            />
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
        open={createFlows.pollModalOpen}
        busy={createFlows.isInspectingPoll || createFlows.isCreating}
        error={createFlows.pollError}
        review={
          createFlows.pollResult
            ? {
                derivedCount: createFlows.pollResult.derivedInputs.length,
                skippedFields: createFlows.pollResult.skippedFields,
              }
            : null
        }
        onClose={createFlows.closePollModal}
        onSubmit={createFlows.startFromPoll}
        onConfirm={createFlows.confirmFromPoll}
      />
    </MainSidebarPageShell>
  );
}
