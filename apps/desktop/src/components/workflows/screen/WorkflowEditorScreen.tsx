import { useEffect, useMemo, useState, type DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  createWorkflowStep,
  parseWorkflowDefinition,
  serializeWorkflowDefinition,
  WORKFLOW_INTEGRATION_LAUNCH_NAMESPACES,
  WORKFLOW_MAX_AGENTS,
  type AgentEmitStep,
  type WorkflowAgentNode,
  type WorkflowDefinition,
  type WorkflowInputSpec,
  type WorkflowStep,
  type WorkflowStepKind,
} from "@proliferate/product-domain/workflows/definition";
import { templateSuggestions } from "@proliferate/product-domain/workflows/interpolation";
import { WORKFLOW_STEP_META } from "@proliferate/product-domain/workflows/presentation";
import { stepIssues, validateWorkflowDefinition } from "@proliferate/product-domain/workflows/validation";
import { deriveEffectiveConfigs } from "@proliferate/product-domain/workflows/effective-config";
import { MainSidebarPageShell } from "@/components/workspace/shell/screen/MainSidebarPageShell";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Spinner } from "@proliferate/ui/primitives/Spinner";
import { ArrowLeft, CircleAlert, Plus, Robot, X } from "@proliferate/ui/icons";
import {
  POPOVER_SURFACE_CLASS,
  PopoverButton,
} from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { WorkflowStepKindBadge } from "@proliferate/product-ui/workflows/WorkflowStepKindBadge";
import { EmptyState } from "@proliferate/ui/layout/EmptyState";
import { useCloudAgentCatalog } from "@/hooks/access/cloud/agent-catalog/use-cloud-agent-catalog";
import { useCloudRunTargetWorkspaces } from "@/hooks/access/cloud/workspaces/use-cloud-run-target-workspaces";
import { useWorkflowDetail, useWorkflows } from "@/hooks/access/cloud/workflows/use-workflows";
import { useWorkflowMutations } from "@/hooks/access/cloud/workflows/use-workflow-mutations";
import { useWorkflowSlackChannels } from "@/hooks/access/cloud/workflows/use-workflow-slack-channels";
import { useCloudIntegrations } from "@/hooks/cloud/facade/use-cloud-integrations";
import { useActiveOrganization } from "@/hooks/organizations/facade/use-active-organization";
import { harnessSupportsGoals } from "@/lib/domain/workflows/goal-capability";
import { WorkflowMetaCard } from "../editor/WorkflowMetaCard";
import { WorkflowSetupCard } from "../editor/WorkflowSetupCard";
import { WorkflowScopeHeader } from "../editor/WorkflowScopeHeader";
import {
  WorkflowTriggersCard,
  type WorkflowTriggerRepoOption,
} from "../editor/WorkflowTriggersCard";
import {
  WorkflowFunctionsCard,
  type WorkflowFunctionProviderOption,
} from "../editor/WorkflowFunctionsCard";
import { WorkflowStepRailCard } from "../editor/WorkflowStepRailCard";
import { WorkflowStepPanel, type EditorAgent } from "../editor/WorkflowStepPanel";
import { WorkflowSelect } from "../editor/WorkflowSelect";

interface CatalogModel {
  id: string;
  displayName?: string | null;
}
interface CatalogAgent {
  kind: string;
  displayName: string;
  models: CatalogModel[];
}

interface Draft {
  name: string;
  description: string;
  definition: WorkflowDefinition;
}

const STEP_KINDS: WorkflowStepKind[] = ["agent.prompt", "agent.emit", "agent.config", "shell.run", "scm.open_pr", "notify", "branch", "workflow.include"];

const EMPTY_NODE: WorkflowAgentNode = { slot: "main", harness: "", model: "", steps: [] };

/** A fresh, unused agent slot name (`agent_2`, `agent_3`, ...) given the existing nodes. */
function nextAgentSlot(nodes: readonly WorkflowAgentNode[]): string {
  const used = new Set(nodes.map((n) => n.slot));
  let n = nodes.length + 1;
  let candidate = `agent_${n}`;
  while (used.has(candidate)) {
    n += 1;
    candidate = `agent_${n}`;
  }
  return candidate;
}

/** The flattened run-order step index (across the whole agents spine) for a
 * given node/step pair — matches `validateWorkflowDefinition`'s indexing. */
function flatStepIndex(definition: WorkflowDefinition, nodeIndex: number, stepIndex: number): number {
  let flat = 0;
  for (let i = 0; i < nodeIndex; i += 1) {
    flat += definition.agents[i]?.steps.length ?? 0;
  }
  return flat + stepIndex;
}

/** The output_schema's top-level property names, or `[]` when not an object schema. */
function emitOutputSchemaFields(outputSchema: Record<string, unknown>): string[] {
  const properties = outputSchema.properties;
  return properties && typeof properties === "object" && !Array.isArray(properties)
    ? Object.keys(properties as Record<string, unknown>)
    : [];
}

function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item!);
  return copy;
}

export interface WorkflowEditorScreenProps {
  workflowId: string;
}

export function WorkflowEditorScreen({ workflowId }: WorkflowEditorScreenProps) {
  const navigate = useNavigate();
  const detailQuery = useWorkflowDetail(workflowId);
  const catalogQuery = useCloudAgentCatalog();
  const cloudTargetsQuery = useCloudRunTargetWorkspaces();
  const slackChannelsQuery = useWorkflowSlackChannels();
  const workflowsQuery = useWorkflows();
  const { activeOrganizationId } = useActiveOrganization();
  const { integrations: cloudIntegrations } = useCloudIntegrations(activeOrganizationId);
  const { updateMutation } = useWorkflowMutations();

  const [draft, setDraft] = useState<Draft | null>(null);
  // Selection is addressed by (nodeIndex, stepIndex) — agents are top-level
  // rail items, each with its own nested steps.
  const [selectedStep, setSelectedStep] = useState<{ nodeIndex: number; stepIndex: number } | null>(null);
  const [setupNodeIndex, setSetupNodeIndex] = useState<number | null>(null);
  const [dragKey, setDragKey] = useState<{ nodeIndex: number; stepIndex: number } | null>(null);
  const [dragAgentIndex, setDragAgentIndex] = useState<number | null>(null);
  const [addOpenNodeIndex, setAddOpenNodeIndex] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  // Tracks edits made since the last load/save, independent of `saved` (which
  // only flips true right after a successful save) — drives the header's
  // "Unsaved changes" vs "Saved" status line.
  const [dirty, setDirty] = useState(false);

  // Seed the draft once the detail loads. A brand-new / empty definition has
  // no agent node yet — seed one so the editor always has a slot to edit.
  useEffect(() => {
    if (draft === null && detailQuery.data) {
      const raw = detailQuery.data.currentVersion?.definition;
      const parsed = parseWorkflowDefinition(raw ?? null);
      const definition: WorkflowDefinition =
        parsed.agents.length > 0 ? parsed : { ...parsed, agents: [{ ...EMPTY_NODE }] };
      setDraft({
        name: detailQuery.data.workflow.name,
        description: detailQuery.data.workflow.description ?? "",
        definition,
      });
    }
  }, [draft, detailQuery.data]);

  const agents = useMemo<EditorAgent[]>(
    () =>
      ((catalogQuery.data?.agents ?? []) as CatalogAgent[]).map((agent) => ({
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

  // Gateway integration namespaces (spec 6.1/6.3, L21): the owner's visible
  // integrations, restricted client-side to the launch set (issues, slack) —
  // everything else is "more arrive later" per the card's caption.
  const functionProviders = useMemo<WorkflowFunctionProviderOption[]>(
    () =>
      cloudIntegrations
        .filter((integration) =>
          (WORKFLOW_INTEGRATION_LAUNCH_NAMESPACES as readonly string[]).includes(integration.namespace),
        )
        .map((integration) => ({
          namespace: integration.namespace,
          displayName: integration.displayName,
          connected: integration.accountId !== null && integration.health === "ready",
        })),
    [cloudIntegrations],
  );

  const issues = useMemo(
    () =>
      draft
        ? validateWorkflowDefinition(draft.definition, {
            harnessSupportsGoals: harnessSupportsGoals,
            workflowId,
          })
        : [],
    [draft, workflowId],
  );

  // Owner's other non-archived workflows — the workflow.include picker source.
  const includableWorkflows = useMemo(
    () =>
      (workflowsQuery.data?.workflows ?? [])
        .filter((wf) => wf.id !== workflowId && wf.archivedAt === null)
        .map((wf) => ({ id: wf.id, name: wf.name })),
    [workflowsQuery.data, workflowId],
  );

  const effectiveConfigs = useMemo(
    () => (draft ? deriveEffectiveConfigs(draft.definition) : []),
    [draft],
  );

  const nodes = draft ? draft.definition.agents : [];

  const suggestions = useMemo(() => {
    if (draft === null || selectedStep === null) {
      return [];
    }
    // Only steps strictly prior in run order — across earlier nodes in full,
    // plus this node up to (excluding) the selected step.
    const priorEmits: { emit: string; stepLabel: string; fieldNames: string[] }[] = [];
    draft.definition.agents.forEach((n, nodeIndex) => {
      const upTo = nodeIndex < selectedStep.nodeIndex ? n.steps.length : nodeIndex === selectedStep.nodeIndex ? selectedStep.stepIndex : 0;
      n.steps.slice(0, upTo).forEach((step) => {
        if (step.kind === "agent.emit") {
          const emitStep = step as AgentEmitStep;
          priorEmits.push({
            emit: emitStep.name,
            stepLabel: WORKFLOW_STEP_META[emitStep.kind].label,
            fieldNames: emitStep.outputSchema ? emitOutputSchemaFields(emitStep.outputSchema) : [],
          });
        }
      });
    });
    return templateSuggestions({
      inputs: draft.definition.inputs.map((input) => ({ name: input.name, type: input.type })),
      priorEmits,
    });
  }, [draft, selectedStep]);

  if (detailQuery.isError) {
    return (
      <MainSidebarPageShell>
        <div className="mx-auto max-w-3xl px-8 pt-16">
          <EmptyState title="Workflow not found" description="It may have been archived or is not accessible." />
        </div>
      </MainSidebarPageShell>
    );
  }

  if (draft === null) {
    return (
      <MainSidebarPageShell>
        <div className="flex h-full items-center justify-center text-muted-foreground">
          <Spinner />
        </div>
      </MainSidebarPageShell>
    );
  }

  const definition = draft.definition;
  const markDirty = () => {
    setSaved(false);
    setDirty(true);
  };

  const patchDefinition = (next: Partial<WorkflowDefinition>) => {
    markDirty();
    setDraft((prev) => (prev ? { ...prev, definition: { ...prev.definition, ...next } } : prev));
  };

  const patchNode = (nodeIndex: number, next: Partial<WorkflowAgentNode>) => {
    patchDefinition({
      agents: definition.agents.map((n, i) => (i === nodeIndex ? { ...n, ...next } : n)),
    });
  };

  const setModel = (nodeIndex: number, model: string) => patchNode(nodeIndex, { model });
  const setInputs = (inputs: WorkflowInputSpec[]) => patchDefinition({ inputs });
  const setIntegrations = (integrations: string[]) => patchDefinition({ integrations });

  const updateStep = (nodeIndex: number, stepIndex: number, step: WorkflowStep) =>
    patchNode(nodeIndex, {
      steps: definition.agents[nodeIndex]!.steps.map((s, i) => (i === stepIndex ? step : s)),
    });

  const addStep = (nodeIndex: number, kind: WorkflowStepKind) => {
    markDirty();
    const steps = [...definition.agents[nodeIndex]!.steps, createWorkflowStep(kind)];
    patchNode(nodeIndex, { steps });
    setSelectedStep({ nodeIndex, stepIndex: steps.length - 1 });
    setAddOpenNodeIndex(null);
  };

  const duplicateStep = (nodeIndex: number, stepIndex: number) => {
    markDirty();
    const steps = definition.agents[nodeIndex]!.steps;
    const clone = JSON.parse(JSON.stringify(steps[stepIndex])) as WorkflowStep;
    patchNode(nodeIndex, {
      steps: [...steps.slice(0, stepIndex + 1), clone, ...steps.slice(stepIndex + 1)],
    });
  };

  const deleteStep = (nodeIndex: number, stepIndex: number) => {
    markDirty();
    patchNode(nodeIndex, { steps: definition.agents[nodeIndex]!.steps.filter((_, i) => i !== stepIndex) });
    setSelectedStep(null);
  };

  const reorderStep = (nodeIndex: number, from: number, to: number) => {
    if (from === to) {
      return;
    }
    markDirty();
    patchNode(nodeIndex, { steps: moveItem(definition.agents[nodeIndex]!.steps, from, to) });
    setSelectedStep(null);
  };

  // --- Agent-node (top-level rail item) operations --------------------------

  const addAgentNode = () => {
    markDirty();
    const newNode: WorkflowAgentNode = { slot: nextAgentSlot(definition.agents), harness: "", model: "", steps: [] };
    patchDefinition({ agents: [...definition.agents, newNode] });
    setSetupNodeIndex(definition.agents.length);
    setSelectedStep(null);
  };

  const deleteAgentNode = (nodeIndex: number) => {
    if (definition.agents.length <= 1) {
      return;
    }
    markDirty();
    patchDefinition({ agents: definition.agents.filter((_, i) => i !== nodeIndex) });
    setSetupNodeIndex(null);
    setSelectedStep(null);
  };

  const reorderAgentNode = (from: number, to: number) => {
    if (from === to) {
      return;
    }
    markDirty();
    patchDefinition({ agents: moveItem(definition.agents, from, to) });
    setSetupNodeIndex(null);
    setSelectedStep(null);
  };

  const handleSave = () => {
    updateMutation.mutate(
      {
        workflowId,
        body: {
          name: draft.name,
          description: draft.description || undefined,
          definition: serializeWorkflowDefinition(definition),
        },
      },
      {
        onSuccess: () => {
          setSaved(true);
          setDirty(false);
        },
      },
    );
  };

  const nameInvalid = draft.name.trim() === "";
  const canSave = !nameInvalid && issues.length === 0 && !updateMutation.isPending;

  // Resolve raw harness/model ids to their catalog display labels for the
  // scope-boundary headers. Falls back to the raw id when not in the catalog.
  const resolveAgentLabels = (harnessKind: string, modelId: string) => {
    const agent = agents.find((a) => a.kind === harnessKind);
    return {
      harness: agent?.displayName ?? (harnessKind || "No agent"),
      model: agent?.models.find((m) => m.id === modelId)?.label ?? modelId ?? "",
    };
  };

  // Running action counter: agent.config scope boundaries do NOT consume a
  // number; only real actions are numbered 1..N.
  let actionNumber = 0;

  return (
    <MainSidebarPageShell>
      <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-border px-6 py-3 pt-10">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => navigate("/workflows")}
              className="inline-flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" />
              Workflows
            </button>
            <span aria-hidden className="shrink-0 text-faint">/</span>
            <span className="truncate text-sm font-medium text-foreground">
              {draft.name || "Untitled workflow"}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {issues.length > 0 ? (
              <PopoverButton
                align="end"
                side="bottom"
                className={`w-80 ${POPOVER_SURFACE_CLASS}`}
                trigger={(
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/15"
                  >
                    <CircleAlert className="size-3.5" />
                    {issues.length} {issues.length === 1 ? "issue" : "issues"}
                  </button>
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
            ) : dirty ? (
              <span className="text-xs text-muted-foreground">Unsaved changes</span>
            ) : saved ? (
              <span className="text-xs font-medium text-success">Saved</span>
            ) : null}
            <Button size="sm" onClick={handleSave} loading={updateMutation.isPending} disabled={!canSave}>
              Save
            </Button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 overflow-hidden transition-[grid-template-columns] duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] grid-cols-[1fr]" style={selectedStep !== null || setupNodeIndex !== null ? { gridTemplateColumns: "1fr minmax(0, min(50%, 420px))" } : undefined}>
          <div
            className="min-w-0 overflow-y-auto bg-[radial-gradient(circle_at_1px_1px,var(--color-border)_1px,transparent_0)] [background-size:16px_16px]"
          >
            <div className="mx-auto flex max-w-[720px] flex-col gap-3 px-6 py-6">
              <WorkflowMetaCard
                name={draft.name}
                description={draft.description}
                onNameChange={(name) => {
                  markDirty();
                  setDraft((prev) => (prev ? { ...prev, name } : prev));
                }}
                onDescriptionChange={(description) => {
                  markDirty();
                  setDraft((prev) => (prev ? { ...prev, description } : prev));
                }}
              />
              <WorkflowSetupCard inputs={definition.inputs} agents={agents} onInputsChange={setInputs} />
              <WorkflowFunctionsCard
                integrations={definition.integrations}
                providers={functionProviders}
                onChange={setIntegrations}
              />
              <WorkflowTriggersCard
                workflowId={workflowId}
                args={definition.inputs}
                repoOptions={triggerRepoOptions}
                onOpenRun={(runId) => navigate(`/workflows/${workflowId}/runs/${runId}`)}
              />

              {/* Agents as top-level rail items: each node is its own scope
                  boundary (a harness/model header) with its steps nested
                  underneath. Switching agents = a new node; switching model
                  within a node = an inline agent.config step. */}
              {nodes.map((agentNode, nodeIndex) => {
                actionNumber = 0;
                return (
                  <div key={nodeIndex} className="flex flex-col">
                    <div
                      draggable
                      onDragStart={() => setDragAgentIndex(nodeIndex)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => {
                        if (dragAgentIndex !== null) {
                          reorderAgentNode(dragAgentIndex, nodeIndex);
                        }
                        setDragAgentIndex(null);
                      }}
                    >
                      <WorkflowScopeHeader
                        variant="initial"
                        {...resolveAgentLabels(agentNode.harness, agentNode.model)}
                        selected={setupNodeIndex === nodeIndex}
                        invalid={issues.some(
                          (issue) => issue.location.scope === "agent" && issue.location.nodeIndex === nodeIndex,
                        )}
                        canMoveUp={nodeIndex > 0}
                        canMoveDown={nodeIndex < nodes.length - 1}
                        onSelect={() => { setSetupNodeIndex(nodeIndex); setSelectedStep(null); }}
                        onMoveUp={() => reorderAgentNode(nodeIndex, nodeIndex - 1)}
                        onMoveDown={() => reorderAgentNode(nodeIndex, nodeIndex + 1)}
                        onDelete={nodes.length > 1 ? () => deleteAgentNode(nodeIndex) : undefined}
                      />
                    </div>

                    <div className="flex flex-col pl-4">
                      {agentNode.steps.map((step, stepIndex) => {
                        const flatIndex = flatStepIndex(definition, nodeIndex, stepIndex);
                        const thisConfig = effectiveConfigs[flatIndex];
                        const dragProps = {
                          draggable: true,
                          onDragStart: () => setDragKey({ nodeIndex, stepIndex }),
                          onDragOver: (event: DragEvent) => event.preventDefault(),
                          onDrop: () => {
                            if (dragKey !== null && dragKey.nodeIndex === nodeIndex) {
                              reorderStep(nodeIndex, dragKey.stepIndex, stepIndex);
                            }
                            setDragKey(null);
                          },
                        } as const;
                        const isSelected =
                          selectedStep?.nodeIndex === nodeIndex && selectedStep.stepIndex === stepIndex;

                        // Agent config is a SCOPE BOUNDARY, not a numbered action —
                        // render it as a header/divider with no spine number. In v2
                        // it only ever switches the model (harness is fixed per node).
                        if (step.kind === "agent.config") {
                          const labels = resolveAgentLabels(
                            thisConfig?.effectiveHarness ?? agentNode.harness,
                            thisConfig?.effectiveModel ?? step.model,
                          );
                          return (
                            <div key={stepIndex} {...dragProps}>
                              <WorkflowScopeHeader
                                variant={thisConfig?.isNewSession ? "new-session" : "model-only"}
                                harness={labels.harness}
                                model={labels.model}
                                selected={isSelected}
                                invalid={stepIssues(issues, flatIndex).length > 0}
                                canMoveUp={stepIndex > 0}
                                canMoveDown={stepIndex < agentNode.steps.length - 1}
                                onSelect={() => { setSelectedStep({ nodeIndex, stepIndex }); setSetupNodeIndex(null); }}
                                onDuplicate={() => duplicateStep(nodeIndex, stepIndex)}
                                onDelete={() => deleteStep(nodeIndex, stepIndex)}
                                onMoveUp={() => reorderStep(nodeIndex, stepIndex, stepIndex - 1)}
                                onMoveDown={() => reorderStep(nodeIndex, stepIndex, stepIndex + 1)}
                              />
                            </div>
                          );
                        }

                        // Real action — number it 1..N ignoring scope boundaries.
                        actionNumber += 1;
                        // Draw the spine only to the next contiguous action. When the
                        // next step is a scope boundary (agent.config), the header is
                        // the clean break, so the spine stops here.
                        const nextIsAction =
                          agentNode.steps[stepIndex + 1] !== undefined &&
                          agentNode.steps[stepIndex + 1]!.kind !== "agent.config";
                        return (
                          <div key={stepIndex} {...dragProps}>
                            <WorkflowStepRailCard
                              step={step}
                              index={stepIndex}
                              stepNumber={actionNumber}
                              selected={isSelected}
                              invalid={stepIssues(issues, flatIndex).length > 0}
                              connector={nextIsAction}
                              canMoveUp={stepIndex > 0}
                              canMoveDown={stepIndex < agentNode.steps.length - 1}
                              onSelect={() => { setSelectedStep({ nodeIndex, stepIndex }); setSetupNodeIndex(null); }}
                              onChange={(next) => updateStep(nodeIndex, stepIndex, next)}
                              onDuplicate={() => duplicateStep(nodeIndex, stepIndex)}
                              onDelete={() => deleteStep(nodeIndex, stepIndex)}
                              onMoveUp={() => reorderStep(nodeIndex, stepIndex, stepIndex - 1)}
                              onMoveDown={() => reorderStep(nodeIndex, stepIndex, stepIndex + 1)}
                            />
                          </div>
                        );
                      })}

                      <div className="flex justify-start pl-[6px]">
                        <PopoverButton
                          align="start"
                          side="bottom"
                          externalOpen={addOpenNodeIndex === nodeIndex}
                          onOpenChange={(open) => setAddOpenNodeIndex(open ? nodeIndex : null)}
                          className={`w-48 ${POPOVER_SURFACE_CLASS}`}
                          trigger={(
                            <button
                              type="button"
                              aria-label="Add step"
                              className="flex size-8 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm outline-none transition-colors hover:border-border-heavy hover:text-foreground data-[state=open]:border-border-heavy data-[state=open]:text-foreground"
                            >
                              <Plus className="size-4" />
                            </button>
                          )}
                        >
                          {(close) => (
                            <div className="p-1">
                              {STEP_KINDS.map((kind) => (
                                <PopoverMenuItem
                                  key={kind}
                                  density="compact"
                                  icon={<WorkflowStepKindBadge kind={kind} iconOnly className="bg-transparent p-0" />}
                                  label={WORKFLOW_STEP_META[kind].label}
                                  onClick={() => { close(); addStep(nodeIndex, kind); }}
                                />
                              ))}
                            </div>
                          )}
                        </PopoverButton>
                      </div>
                    </div>
                  </div>
                );
              })}

              <div className="flex justify-start">
                <Button variant="secondary" size="sm" onClick={addAgentNode} disabled={nodes.length >= WORKFLOW_MAX_AGENTS}>
                  <Plus className="size-3.5" />
                  Add agent
                </Button>
              </div>
            </div>
          </div>

          {selectedStep !== null && nodes[selectedStep.nodeIndex]?.steps[selectedStep.stepIndex] ? (
            <div className="overflow-hidden border-l border-border bg-background">
              <WorkflowStepPanel
                step={nodes[selectedStep.nodeIndex]!.steps[selectedStep.stepIndex]!}
                effectiveHarness={nodes[selectedStep.nodeIndex]!.harness}
                agents={agents}
                suggestions={suggestions}
                slackConnected={slackChannelsQuery.data?.connected ?? false}
                slackChannels={slackChannelsQuery.data?.channels ?? []}
                includableWorkflows={includableWorkflows}
                supportsGoals={harnessSupportsGoals}
                onChange={(next) => updateStep(selectedStep.nodeIndex, selectedStep.stepIndex, next)}
                onClose={() => setSelectedStep(null)}
              />
            </div>
          ) : setupNodeIndex !== null && nodes[setupNodeIndex] ? (
            <div className="flex h-full flex-col overflow-hidden border-l border-border bg-background">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <span className="inline-flex select-none items-center gap-1.5 rounded-full border border-border bg-transparent px-3 py-0.5 text-xs font-medium leading-none text-foreground">
                  <Robot className="size-3.5 shrink-0 text-foreground" />
                  <span>Agent</span>
                </span>
                <Button variant="ghost" size="icon-sm" onClick={() => setSetupNodeIndex(null)} aria-label="Close panel">
                  <X className="size-4" />
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <div className="flex flex-col gap-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="w-28 shrink-0 text-sm text-muted-foreground">Name</span>
                    <div className="flex flex-1 justify-end">
                      <Input
                        aria-label="Agent name"
                        value={nodes[setupNodeIndex]!.slot}
                        placeholder="agent_1"
                        className="font-mono"
                        onChange={(event) => patchNode(setupNodeIndex, { slot: event.target.value })}
                      />
                    </div>
                  </div>
                  {(() => {
                    const slotIssue = issues.find(
                      (issue) =>
                        issue.location.scope === "agent" &&
                        issue.location.nodeIndex === setupNodeIndex &&
                        issue.location.field === "slot",
                    );
                    return slotIssue ? (
                      <p className="-mt-2 text-xs text-destructive">{slotIssue.message}</p>
                    ) : (
                      <p className="-mt-2 text-xs text-faint">
                        Identifies this agent's session across runs — lowercase letters, digits, underscores.
                      </p>
                    );
                  })()}
                  <div className="flex items-center justify-between gap-3">
                    <span className="w-28 shrink-0 text-sm text-muted-foreground">Agent</span>
                    <div className="flex flex-1 justify-end">
                      <WorkflowSelect
                        ariaLabel="Agent"
                        value={nodes[setupNodeIndex]!.harness || ""}
                        placeholder="Select agent"
                        options={agents.map((agent) => ({ value: agent.kind, label: agent.displayName }))}
                        onChange={(harness) => {
                          markDirty();
                          const next = agents.find((agent) => agent.kind === harness);
                          patchNode(setupNodeIndex, { harness, model: next?.models[0]?.id ?? "" });
                        }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="w-28 shrink-0 text-sm text-muted-foreground">Model</span>
                    <div className="flex flex-1 justify-end">
                      <WorkflowSelect
                        ariaLabel="Model"
                        value={nodes[setupNodeIndex]!.model || ""}
                        placeholder="Select model"
                        disabled={(agents.find((a) => a.kind === nodes[setupNodeIndex]!.harness)?.models ?? []).length === 0}
                        options={(agents.find((a) => a.kind === nodes[setupNodeIndex]!.harness)?.models ?? []).map((model) => ({ value: model.id, label: model.label }))}
                        onChange={(model) => setModel(setupNodeIndex, model)}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </MainSidebarPageShell>
  );
}
