import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { WORKFLOW_INTEGRATION_LAUNCH_NAMESPACES } from "@proliferate/product-domain/workflows/definition";
import type { SpineAddress } from "@proliferate/product-domain/workflows/spine-editing";
import { MainSidebarPageShell } from "@/components/workspace/shell/screen/MainSidebarPageShell";
import { Button } from "@proliferate/ui/primitives/Button";
import { Spinner } from "@proliferate/ui/primitives/Spinner";
import { ArrowLeft, CircleAlert, Play } from "@proliferate/ui/icons";
import {
  POPOVER_SURFACE_CLASS,
  PopoverButton,
} from "@proliferate/ui/primitives/PopoverButton";
import { EmptyState } from "@proliferate/ui/layout/EmptyState";
import { useCloudAgentCatalog } from "@/hooks/access/cloud/agent-catalog/use-cloud-agent-catalog";
import { useCloudRunTargetWorkspaces } from "@/hooks/access/cloud/workspaces/use-cloud-run-target-workspaces";
import { useWorkflows } from "@/hooks/access/cloud/workflows/use-workflows";
import { useWorkflowSlackChannels } from "@/hooks/access/cloud/workflows/use-workflow-slack-channels";
import { useCloudIntegrations } from "@/hooks/cloud/facade/use-cloud-integrations";
import { useFunctionInvocations } from "@/hooks/access/cloud/integrations/use-function-invocations";
import { useActiveOrganization } from "@/hooks/organizations/facade/use-active-organization";
import { useWorkspaces } from "@/hooks/workspaces/cache/use-workspaces";
import { buildLocalAutomationRepoCandidates } from "@/lib/domain/automations/local-executor/plan";
import { harnessSupportsGoals } from "@/lib/domain/workflows/goal-capability";
import { useWorkflowEditorDraft } from "@/hooks/workflows/workflows/use-workflow-editor-draft";
import { useWorkflowTriggers } from "@/hooks/access/cloud/workflows/use-workflow-triggers";
import { useWorkflowRunLauncher } from "@/hooks/access/cloud/workflows/use-workflow-run-launcher";
import type { WorkflowTriggerRepoOption } from "../editor/WorkflowTriggersCard";
import type { WorkflowFunctionProviderOption } from "../editor/WorkflowFunctionsCard";
import { WorkflowSetupInspector } from "../editor/WorkflowSetupInspector";
import { WorkflowAgentInspector } from "../editor/WorkflowAgentInspector";
import { WorkflowSpineCanvas } from "../editor/WorkflowSpineCanvas";
import { WorkflowStepPanel, type EditorAgent } from "../editor/WorkflowStepPanel";

export interface WorkflowEditorScreenProps {
  workflowId: string;
}

export function WorkflowEditorScreen({ workflowId }: WorkflowEditorScreenProps) {
  const navigate = useNavigate();
  const catalogQuery = useCloudAgentCatalog();
  const cloudTargetsQuery = useCloudRunTargetWorkspaces();
  const slackChannelsQuery = useWorkflowSlackChannels();
  const workflowsQuery = useWorkflows();
  const { activeOrganizationId } = useActiveOrganization();
  const { integrations: cloudIntegrations } = useCloudIntegrations(activeOrganizationId);
  const functionInvocationsQuery = useFunctionInvocations();
  const launcher = useWorkflowRunLauncher();
  const editor = useWorkflowEditorDraft(workflowId);
  // Trigger facts for the setup summary card (chips only; editing lives in the
  // setup inspector's Triggers section).
  const triggersQuery = useWorkflowTriggers(workflowId);
  const triggerChips = useMemo(() => {
    const chips = ["manual"];
    for (const trigger of triggersQuery.data ?? []) {
      if (!trigger.enabled) continue;
      if (trigger.kind === "schedule") {
        chips.push(trigger.repoFullName ? `scheduled · ${trigger.repoFullName.split("/")[1]}` : "scheduled");
      } else if (trigger.kind === "poll") {
        chips.push(trigger.repoFullName ? `polls a feed · ${trigger.repoFullName.split("/")[1]}` : "polls a feed");
      }
    }
    return chips;
  }, [triggersQuery.data]);

  const agents = useMemo<EditorAgent[]>(
    () =>
      ((catalogQuery.data?.agents ?? []) as { kind: string; displayName: string; models: { id: string; displayName?: string | null }[] }[]).map((agent) => ({
        kind: agent.kind,
        displayName: agent.displayName,
        models: agent.models.map((model) => ({ id: model.id, label: model.displayName ?? model.id })),
      })),
    [catalogQuery.data],
  );

  // D16: triggers pin a repo (the server derives + owns the workspace). The repo
  // options are the unique "owner/name" repos the owner's cloud workspaces cover.
  const triggerRepoOptions = useMemo<WorkflowTriggerRepoOption[]>(() => {
    const seen = new Map<string, WorkflowTriggerRepoOption>();
    for (const workspace of cloudTargetsQuery.data ?? []) {
      const fullName = `${workspace.repo.owner}/${workspace.repo.name}`;
      if (!seen.has(fullName)) seen.set(fullName, { fullName, label: fullName });
    }
    return [...seen.values()];
  }, [cloudTargetsQuery.data]);

  // D-028①/D16 local lane: the desktop's local clones a LOCAL schedule trigger
  // can pin — the exact same candidate source the local claim executor
  // (`useLocalWorkflowClaimPoller`) matches a fired run's repo pin against, so a
  // repo offered here is guaranteed claimable on this device.
  const workspacesQuery = useWorkspaces();
  const localTriggerRepoOptions = useMemo<WorkflowTriggerRepoOption[]>(() => {
    const candidates = buildLocalAutomationRepoCandidates({
      repoRoots: workspacesQuery.data?.repoRoots ?? [],
      workspaces: workspacesQuery.data?.localWorkspaces ?? [],
    });
    return candidates.map((candidate) => {
      const fullName = `${candidate.repoRoot.remoteOwner}/${candidate.repoRoot.remoteRepoName}`;
      return { fullName, label: candidate.repoRoot.displayName?.trim() || fullName };
    });
  }, [workspacesQuery.data]);

  // Gateway integration namespaces (spec 6.1/6.3, L21): the owner's visible
  // integrations, restricted client-side to the launch set (issues, slack) —
  // everything else is "more arrive later" per the card's caption. `functions`
  // (track 1b) has no integration-definition row — the server never returns it
  // from the catalog — so its picker entry is synthesized here, gated on the
  // owner having ≥1 function invocation (mirrors the server's
  // `visible_provider_namespaces` readiness check, gateway_grants.py).
  const hasFunctionInvocations = (functionInvocationsQuery.data?.items.length ?? 0) > 0;
  const functionProviders = useMemo<WorkflowFunctionProviderOption[]>(() => {
    const providers = cloudIntegrations
      .filter((integration) =>
        (WORKFLOW_INTEGRATION_LAUNCH_NAMESPACES as readonly string[]).includes(integration.namespace),
      )
      .map((integration) => ({
        namespace: integration.namespace,
        displayName: integration.displayName,
        connected: integration.accountId !== null && integration.health === "ready",
      }));
    if (hasFunctionInvocations) {
      providers.push({ namespace: "functions", displayName: "Functions", connected: true });
    }
    return providers;
  }, [cloudIntegrations, hasFunctionInvocations]);
  const functionProviderDisplayNames = useMemo(
    () => new Map(functionProviders.map((provider) => [provider.namespace, provider.displayName])),
    [functionProviders],
  );

  // The owner's function invocations — the exact-tool universe for a required
  // invocation on the `functions` provider (WS9b item 2).
  const functionInvocations = useMemo(
    () =>
      (functionInvocationsQuery.data?.items ?? []).map((invocation) => ({
        name: invocation.name,
        displayName: invocation.displayName,
      })),
    [functionInvocationsQuery.data],
  );

  // Owner's other non-archived workflows — the workflow.include picker source.
  const includableWorkflows = useMemo(
    () =>
      (workflowsQuery.data?.workflows ?? [])
        .filter((wf) => wf.id !== workflowId && wf.archivedAt === null)
        .map((wf) => ({ id: wf.id, name: wf.name })),
    [workflowsQuery.data, workflowId],
  );

  if (editor.detailQuery.isError) {
    return (
      <MainSidebarPageShell>
        <div className="mx-auto max-w-3xl px-8 pt-16">
          <EmptyState title="Workflow not found" description="It may have been archived or is not accessible." />
        </div>
      </MainSidebarPageShell>
    );
  }

  // An unknown definition version / step kind is read-only in this client: never
  // drop unknown data or save a truncated definition (feature spec §5.1).
  if (editor.unsupported) {
    return (
      <MainSidebarPageShell>
        <div className="mx-auto max-w-3xl px-8 pt-16">
          <EmptyState
            title="This workflow needs a newer app"
            description={
              editor.unsupported.reason === "version"
                ? `It was authored in workflow format version ${String(editor.unsupported.version)}, which this version of the app can't edit. Update to edit it — your data is preserved.`
                : "It uses a step type this version of the app doesn't recognize. Update to edit it — your data is preserved."
            }
          />
        </div>
      </MainSidebarPageShell>
    );
  }

  if (editor.draft === null) {
    return (
      <MainSidebarPageShell>
        <div className="flex h-full items-center justify-center text-muted-foreground">
          <Spinner />
        </div>
      </MainSidebarPageShell>
    );
  }

  const { draft, definition, issues, isSeed } = editor;

  const openSetup = () => {
    editor.setSetupOpen(true);
    editor.setSetupTarget(null);
    editor.setSelectedStep(null);
  };

  const selectAgent = (address: SpineAddress) => {
    editor.setSetupTarget(address);
    editor.setSelectedStep(null);
    editor.setSetupOpen(false);
  };

  const selectStep = (address: SpineAddress, stepIndex: number) => {
    editor.setSelectedStep({ ...address, stepIndex });
    editor.setSetupTarget(null);
    editor.setSetupOpen(false);
  };

  const selectedStepNode = editor.selectedStep ? editor.nodeAt(editor.selectedStep) : undefined;
  const selectedStepValue = selectedStepNode?.steps[editor.selectedStep?.stepIndex ?? -1];

  return (
    <MainSidebarPageShell>
      <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-border px-6 py-3 pt-10">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              type="button"
              variant="unstyled"
              size="unstyled"
              onClick={() => navigate("/workflows")}
              className="inline-flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" />
              Workflows
            </Button>
            <span aria-hidden className="shrink-0 text-faint">/</span>
            <span className="truncate text-sm font-medium text-foreground">
              {draft.name || "Untitled workflow"}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {isSeed ? (
              <>
                <span className="text-xs text-muted-foreground">
                  Starter template · read-only
                </span>
                <Button
                  size="sm"
                  onClick={editor.duplicateSeed}
                  loading={editor.isDuplicating}
                >
                  Duplicate to edit
                </Button>
              </>
            ) : issues.length > 0 ? (
              <PopoverButton
                align="end"
                side="bottom"
                className={`w-80 ${POPOVER_SURFACE_CLASS}`}
                trigger={(
                  <Button
                    type="button"
                    variant="unstyled"
                    size="unstyled"
                    className="inline-flex items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/15"
                  >
                    <CircleAlert className="size-3.5" />
                    {issues.length} {issues.length === 1 ? "issue" : "issues"}
                  </Button>
                )}
              >
                {() => (
                  <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto p-1.5">
                    {issues.map((issue, index) => (
                      <li
                        key={index}
                        className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm text-popover-foreground"
                      >
                        <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                        <span className="min-w-0">{issue.message}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </PopoverButton>
            ) : editor.dirty ? (
              <span className="text-xs text-muted-foreground">Unsaved changes</span>
            ) : editor.saved ? (
              <span className="text-xs font-medium text-success">Saved</span>
            ) : null}
            {editor.saveError ? (
              <span className="max-w-[220px] truncate text-xs text-destructive" title={editor.saveError}>
                {editor.saveError}
              </span>
            ) : null}
            {isSeed ? null : (
              <Button size="sm" variant="secondary" onClick={editor.handleSave} loading={editor.isSaving} disabled={!editor.canSave}>
                Save
              </Button>
            )}
            <Button
              size="sm"
              disabled={issues.length > 0 || editor.dirty}
              title={editor.dirty ? "Save your changes first" : issues.length > 0 ? "Fix the issues first" : undefined}
              onClick={() => {
                if (editor.detailQuery.data) {
                  launcher.open(editor.detailQuery.data.workflow, definition!);
                }
              }}
            >
              <Play className="size-3.5" />
              Run
            </Button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 overflow-hidden transition-[grid-template-columns] duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] grid-cols-[1fr]" style={editor.selectedStep !== null || editor.setupTarget !== null || editor.setupOpen ? { gridTemplateColumns: "1fr minmax(0, min(50%, 420px))" } : undefined}>
          <WorkflowSpineCanvas
            name={draft.name}
            description={draft.description}
            definition={definition!}
            issues={issues}
            agents={agents}
            functionProviderDisplayNames={functionProviderDisplayNames}
            triggerChips={triggerChips}
            setupOpen={editor.setupOpen}
            selectedStep={editor.selectedStep}
            setupTarget={editor.setupTarget}
            totalAgentCount={editor.totalAgentCount}
            dragStepId={editor.dragStepId}
            onDragStepIdChange={editor.setDragStepId}
            dragEntryId={editor.dragEntryId}
            onDragEntryIdChange={editor.setDragEntryId}
            dragLaneId={editor.dragLaneId}
            onDragLaneIdChange={editor.setDragLaneId}
            onOpenSetup={openSetup}
            onSelectAgent={selectAgent}
            onSelectStep={selectStep}
            onAddStep={editor.addStep}
            onReorderStep={editor.reorderStep}
            onDuplicateStep={editor.duplicateStep}
            onDeleteStep={editor.deleteStep}
            onAddAgentNode={editor.addAgentNode}
            onAddAgentInParallel={editor.addAgentInParallel}
            onParallelizeEntry={editor.parallelizeEntry}
            onAddLane={editor.addLane}
            onRemoveLane={editor.removeLane}
            onDeleteSpineEntry={editor.deleteSpineEntry}
            onReorderSpineEntry={editor.reorderSpineEntry}
            onReorderLane={editor.reorderLane}
          />

          {editor.setupOpen ? (
            <WorkflowSetupInspector
              workflowId={workflowId}
              name={draft.name}
              description={draft.description}
              onNameChange={editor.setName}
              onDescriptionChange={editor.setDescription}
              inputs={definition!.inputs}
              agents={agents}
              onInputsChange={editor.setInputs}
              integrations={definition!.integrations}
              functionProviders={functionProviders}
              onIntegrationsChange={editor.setIntegrations}
              repoOptions={triggerRepoOptions}
              localRepoOptions={localTriggerRepoOptions}
              onOpenRun={(runId) => navigate(`/workflows/${workflowId}/runs/${runId}`)}
              onClose={() => editor.setSetupOpen(false)}
            />
          ) : editor.selectedStep !== null && selectedStepValue ? (
            <div className="overflow-hidden border-l border-border bg-background">
              <WorkflowStepPanel
                step={selectedStepValue}
                effectiveHarness={selectedStepNode!.harness}
                agents={agents}
                suggestions={editor.suggestions}
                slackConnected={slackChannelsQuery.data?.connected ?? false}
                slackChannels={slackChannelsQuery.data?.channels ?? []}
                includableWorkflows={includableWorkflows}
                integrations={definition!.integrations}
                functionInvocations={functionInvocations}
                supportsGoals={harnessSupportsGoals}
                onChange={(next) => editor.updateStep(editor.selectedStep!, editor.selectedStep!.stepIndex, next)}
                onClose={() => editor.setSelectedStep(null)}
              />
            </div>
          ) : editor.setupTarget !== null && editor.nodeAt(editor.setupTarget) ? (
            <WorkflowAgentInspector
              definition={definition!}
              setupTarget={editor.setupTarget}
              issues={issues}
              agents={agents}
              functionProviderDisplayNames={functionProviderDisplayNames}
              onPatchNode={editor.patchNode}
              onSetModel={editor.setModel}
              onMarkDirty={editor.markDirty}
              onRemoveLane={editor.removeLane}
              onClose={() => editor.setSetupTarget(null)}
            />
          ) : null}
        </div>
      </div>
      {launcher.modal}
    </MainSidebarPageShell>
  );
}
