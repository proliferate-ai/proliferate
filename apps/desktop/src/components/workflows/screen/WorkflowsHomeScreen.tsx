import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createEmptyDefinition,
  isParallelGroup,
  parseWorkflowDefinition,
  serializeWorkflowDefinition,
  spineAgentNodes,
  type WorkflowAgentNode,
  type WorkflowDefinition,
} from "@proliferate/product-domain/workflows/definition";
import { getWorkflow } from "@/lib/access/cloud/workflows";
import {
  freePlanWorkflowLimit,
  workflowCreateAllowed,
  workflowTriggerLabel,
  type WorkflowTargetMode,
} from "@proliferate/product-domain/workflows/model";
import {
  coerceRunStatus,
  formatRunDuration,
  runDotKind,
  workflowRunStatusLabel,
  type WorkflowRunStatus,
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
import { Input } from "@proliferate/ui/primitives/Input";
import { SegmentedControl } from "@proliferate/ui/primitives/SegmentedControl";
import { ArrowLeft, Play, Pencil, Plus, RefreshCw, Search } from "@proliferate/ui/icons";
import { useCloudAgentCatalog } from "@/hooks/access/cloud/agent-catalog/use-cloud-agent-catalog";
import { useWorkflows, useWorkflowRuns } from "@/hooks/access/cloud/workflows/use-workflows";
import { useWorkflowMutations } from "@/hooks/access/cloud/workflows/use-workflow-mutations";
import { useLaunchWorkflowRun } from "@/hooks/access/cloud/workflows/use-launch-workflow-run";
import { useInspectPollEndpoint } from "@/hooks/access/cloud/workflows/use-inspect-poll-endpoint";
import { useCloudRunTargetWorkspaces } from "@/hooks/access/cloud/workspaces/use-cloud-run-target-workspaces";
import { useWorkspaces } from "@/hooks/workspaces/cache/use-workspaces";
import type { WorkflowResponse, WorkflowRunResponse } from "@/hooks/access/cloud/workflows/types";
import { WorkflowListRowContainer } from "../home/WorkflowListRowContainer";
import { WorkflowRunRow, Chip, TargetGlyph, type WorkflowRunRowView } from "../home/WorkflowListRow";
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

// Mirrors gateway_grants.py's L22 fail-fast code — a declared function
// provider with no ready account for the owner. StartRun never silently
// narrows the grant, so this always means "connect the named provider".
const FUNCTION_PROVIDER_NOT_READY_CODE = "workflow_function_provider_not_ready";

type TargetFilter = "all" | "cloud" | "local";
type RunStatusFilter = "all" | "running" | "success" | "failed";

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

function runFilterMatches(filter: RunStatusFilter, status: WorkflowRunStatus): boolean {
  switch (filter) {
    case "all":
      return true;
    case "running":
      return !["completed", "failed", "cancelled", "missed"].includes(status);
    case "success":
      return status === "completed";
    case "failed":
      return status === "failed" || status === "cancelled" || status === "missed";
  }
}

function buildRunRowView(run: WorkflowRunResponse): WorkflowRunRowView {
  const status = coerceRunStatus(run.status);
  const originKind = workflowTriggerLabel(run.triggerKind);
  const ago = relativeTime(run.startedAt ?? run.createdAt);
  return {
    id: run.id,
    dotKind: runDotKind(status),
    statusLabel: workflowRunStatusLabel(status, status === "unknown" ? run.status : run.errorCode),
    originLabel: ago ? `${originKind} · ${ago}` : originKind,
    durationLabel: formatRunDuration(run.startedAt, run.finishedAt),
    target: run.targetMode === "personal_cloud" ? "cloud" : run.targetMode === "local" ? "local" : null,
  };
}

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
  const [pollModalOpen, setPollModalOpen] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const [pollResult, setPollResult] = useState<PollInspectResponse | null>(null);

  const workflowsQuery = useWorkflows();
  const runsQuery = useWorkflowRuns(null);
  const catalogQuery = useCloudAgentCatalog();
  const workspacesQuery = useWorkspaces();
  const cloudTargetsQuery = useCloudRunTargetWorkspaces();
  const { createMutation, archiveMutation } = useWorkflowMutations();
  const launchMutation = useLaunchWorkflowRun();
  const showRunPill = useWorkflowRunPillStore((state) => state.show);
  const inspectPollMutation = useInspectPollEndpoint();

  const workflows = workflowsQuery.data?.workflows ?? [];
  const runs = runsQuery.data?.runs ?? [];
  const agents = catalogQuery.data?.agents as DesktopCatalogAgent[] | undefined;

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

  const openRuns = useMemo(() => {
    if (!open) {
      return [];
    }
    return runs
      .filter((run) => run.workflowId === open.id)
      .filter((run) => runFilterMatches(runFilter, coerceRunStatus(run.status)));
  }, [runs, open, runFilter]);

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
    setRunError(null);
    createMutation.mutate(
      {
        name,
        description: description ?? undefined,
        definition: serializeWorkflowDefinition(definition),
      },
      {
        onSuccess: (detail) => navigate(`/workflows/${detail.workflow.id}/edit`),
        // Surfaced through the same banner as run errors — a silent create
        // failure otherwise just stops the spinner with no explanation.
        onError: (error) => setRunError(error.message),
      },
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

  const showEmptyGallery = !open && !workflowsQuery.isLoading && workflows.length === 0;

  const openLastRun = open ? lastRunByWorkflow.get(open.id) : null;
  const openScheduleChipLabel = null; // schedule facts render per-row; the drill-in header keeps target only.

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
            )
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
          ) : showEmptyGallery ? (
            <WorkflowTemplatesGallery
              busy={createMutation.isPending}
              onUseTemplate={useTemplate}
              onStartFromScratch={startFromScratch}
              onStartFromPoll={openPollModal}
            />
          ) : open ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3 pb-1">
                <span className="min-w-0 flex-1" />
                {openScheduleChipLabel ? <Chip>{openScheduleChipLabel}</Chip> : null}
                {openLastRun?.targetMode ? (
                  <Chip>
                    <TargetGlyph
                      target={openLastRun.targetMode === "personal_cloud" ? "cloud" : "local"}
                      className="size-3"
                    />
                    {openLastRun.targetMode === "personal_cloud" ? "cloud" : "local"}
                  </Chip>
                ) : null}
              </div>
              <div className="flex items-center gap-2 pb-2">
                <SegmentedControl
                  ariaLabel="Filter runs by status"
                  value={runFilter}
                  onChange={setRunFilter}
                  items={[
                    { id: "all", label: "All" },
                    { id: "running", label: "Running" },
                    { id: "success", label: "Completed" },
                    { id: "failed", label: "Failed" },
                  ]}
                />
              </div>
              {openRuns.map((run) => (
                <WorkflowRunRow
                  key={run.id}
                  view={buildRunRowView(run)}
                  onOpen={() => navigate(`/workflows/${open.id}/runs/${run.id}`)}
                />
              ))}
              {openRuns.length === 0 ? (
                <span className="px-1 py-4 text-xs text-faint">
                  {runFilter === "all" ? "No runs yet — Run it to see history here." : "No runs match this filter."}
                </span>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {!canCreate ? (
                <p className="text-ui-sm text-faint">
                  Free plan: one workflow. Archive yours to create another.
                </p>
              ) : null}
              <div className="flex items-center gap-2 pb-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search workflows…"
                    className="h-8 pl-8"
                  />
                </div>
                <SegmentedControl
                  ariaLabel="Filter workflows by run target"
                  value={targetFilter}
                  onChange={setTargetFilter}
                  items={[
                    { id: "all", label: "All" },
                    { id: "cloud", label: "Cloud" },
                    { id: "local", label: "Local" },
                  ]}
                />
              </div>
              {filteredWorkflows.map((workflow) => {
                const last = lastRunByWorkflow.get(workflow.id) ?? null;
                return (
                  <WorkflowListRowContainer
                    key={workflow.id}
                    workflow={workflow}
                    lastRun={last}
                    lastRunAgoLabel={last ? relativeTime(last.startedAt ?? last.createdAt) || "recently" : null}
                    onOpen={(workflowId) => setOpenId(workflowId)}
                    onRun={handleRun}
                    onEdit={(workflowId) => navigate(`/workflows/${workflowId}/edit`)}
                    onArchive={(workflowId) => archiveMutation.mutate(workflowId)}
                  />
                );
              })}
              {filteredWorkflows.length === 0 ? (
                <span className="px-1 py-4 text-xs text-faint">No workflows match.</span>
              ) : null}
            </div>
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

  /** Drill-in Run button: fetch the workflow's current definition (cached by
   * the row container's detail query in the common path) and open the shared
   * launch modal — same modal, same submit path as the row Run buttons. */
  async function navigateToRunModal(workflow: WorkflowResponse) {
    setRunError(null);
    setRunErrorCode(null);
    try {
      const detail = await getWorkflow(workflow.id);
      const raw = detail.currentVersion?.definition;
      if (raw) {
        handleRun(workflow, parseWorkflowDefinition(raw));
      }
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error));
    }
  }
}
