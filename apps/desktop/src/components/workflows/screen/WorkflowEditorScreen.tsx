import { useEffect, useMemo, useState, type DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  createWorkflowStep,
  isParallelGroup,
  iterSpineNodes,
  parseWorkflowDefinition,
  serializeWorkflowDefinition,
  spineAgentNodes,
  WORKFLOW_INTEGRATION_LAUNCH_NAMESPACES,
  WORKFLOW_MAX_AGENTS,
  type AgentEmitStep,
  type WorkflowAgentNode,
  type WorkflowDefinition,
  type WorkflowInputSpec,
  type WorkflowParallelGroup,
  type WorkflowStep,
  type WorkflowStepKind,
} from "@proliferate/product-domain/workflows/definition";
import { templateSuggestions } from "@proliferate/product-domain/workflows/interpolation";
import { WORKFLOW_STEP_META } from "@proliferate/product-domain/workflows/presentation";
import { stepIssues, validateWorkflowDefinition } from "@proliferate/product-domain/workflows/validation";
import { deriveEffectiveConfigs } from "@proliferate/product-domain/workflows/effective-config";
import {
  addLaneToGroup,
  getSpineNode,
  nextAgentSlot,
  parallelizeSpineEntry,
  removeLaneFromGroup,
  removeSpineEntry,
  withSpineNode,
  type SpineAddress,
} from "@proliferate/product-domain/workflows/spine-editing";
import { MainSidebarPageShell } from "@/components/workspace/shell/screen/MainSidebarPageShell";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Spinner } from "@proliferate/ui/primitives/Spinner";
import { ArrowLeft, CircleAlert, MoreHorizontal, Plus, Robot, X } from "@proliferate/ui/icons";
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
import { useWorkspaces } from "@/hooks/workspaces/cache/use-workspaces";
import { buildLocalAutomationRepoCandidates } from "@/lib/domain/automations/local-executor/plan";
import { harnessSupportsGoals } from "@/lib/domain/workflows/goal-capability";
import { WorkflowMetaCard } from "../editor/WorkflowMetaCard";
import { WorkflowSetupCard } from "../editor/WorkflowSetupCard";
import { WorkflowScopeHeader } from "../editor/WorkflowScopeHeader";
import {
  WorkflowTriggersCard,
  type WorkflowTriggerRepoOption,
} from "../editor/WorkflowTriggersCard";
import {
  WorkflowAgentIntegrationsRow,
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

/**
 * The flattened run-order step index (across the whole agents spine, lanes
 * lane-grouped in lane order) for a given (spineIndex, lane, stepIndex) —
 * matches `validateWorkflowDefinition`'s indexing (L30 / D-031).
 */
function flatStepIndex(definition: WorkflowDefinition, address: SpineAddress, stepIndex: number): number {
  let flat = 0;
  for (let i = 0; i < address.spineIndex; i += 1) {
    const entry = definition.agents[i]!;
    flat += isParallelGroup(entry)
      ? entry.parallel.reduce((n, node) => n + node.steps.length, 0)
      : entry.steps.length;
  }
  const entry = definition.agents[address.spineIndex];
  if (entry && isParallelGroup(entry)) {
    for (const node of entry.parallel) {
      if (node.slot === address.lane) {
        break;
      }
      flat += node.steps.length;
    }
  }
  return flat + stepIndex;
}

/** The flattened NODE ordinal (across every standalone node and every lane, in
 * flatten order) for `address` — matches `validateWorkflowDefinition`'s
 * `nodeIndex` counter, used to attach agent-level issues (slot/harness/model). */
function nodeOrdinalFor(definition: WorkflowDefinition, address: SpineAddress): number {
  return iterSpineNodes(definition).findIndex(
    (entry) => entry.spineIndex === address.spineIndex && entry.lane === address.lane,
  );
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
  // Selection is addressed by (spineIndex, lane, stepIndex) — agents are
  // top-level rail items, each with its own nested steps; a parallel group
  // (L30 / D-031a) is one spine entry whose lanes are addressed by their slot
  // (lane "-" for a standalone node).
  const [selectedStep, setSelectedStep] = useState<(SpineAddress & { stepIndex: number }) | null>(null);
  const [setupTarget, setSetupTarget] = useState<SpineAddress | null>(null);
  const [dragKey, setDragKey] = useState<(SpineAddress & { stepIndex: number }) | null>(null);
  const [dragSpineIndex, setDragSpineIndex] = useState<number | null>(null);
  const [dragLane, setDragLane] = useState<{ spineIndex: number; laneIndex: number } | null>(null);
  const [addOpenAddress, setAddOpenAddress] = useState<SpineAddress | null>(null);
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
  const functionProviderDisplayNames = useMemo(
    () => new Map(functionProviders.map((provider) => [provider.namespace, provider.displayName])),
    [functionProviders],
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

  const suggestions = useMemo(() => {
    if (draft === null || selectedStep === null) {
      return [];
    }
    // Only steps strictly prior in run order (data-contract §1.3): earlier
    // spine entries in full (every lane, if the entry was a parallel group),
    // earlier steps in the same agent — never a parallel sibling lane.
    const priorEmits: { emit: string; stepLabel: string; fieldNames: string[] }[] = [];
    const collect = (node: WorkflowAgentNode, upTo: number) => {
      node.steps.slice(0, upTo).forEach((step) => {
        if (step.kind === "agent.emit") {
          const emitStep = step as AgentEmitStep;
          priorEmits.push({
            emit: emitStep.name,
            stepLabel: WORKFLOW_STEP_META[emitStep.kind].label,
            fieldNames: emitStep.outputSchema ? emitOutputSchemaFields(emitStep.outputSchema) : [],
          });
        }
      });
    };
    draft.definition.agents.forEach((entry, spineIndex) => {
      if (spineIndex > selectedStep.spineIndex) {
        return;
      }
      if (isParallelGroup(entry)) {
        for (const node of entry.parallel) {
          if (spineIndex === selectedStep.spineIndex) {
            if (node.slot === selectedStep.lane) {
              collect(node, selectedStep.stepIndex);
            }
          } else {
            collect(node, node.steps.length);
          }
        }
      } else {
        collect(entry, spineIndex === selectedStep.spineIndex ? selectedStep.stepIndex : entry.steps.length);
      }
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
  const totalAgentCount = spineAgentNodes(definition).length;
  const nodeAt = (address: SpineAddress) => getSpineNode(definition.agents, address);
  const markDirty = () => {
    setSaved(false);
    setDirty(true);
  };

  const patchDefinition = (next: Partial<WorkflowDefinition>) => {
    markDirty();
    setDraft((prev) => (prev ? { ...prev, definition: { ...prev.definition, ...next } } : prev));
  };

  const patchNode = (address: SpineAddress, next: Partial<WorkflowAgentNode>) => {
    patchDefinition({ agents: withSpineNode(definition.agents, address, (n) => ({ ...n, ...next })) });
  };

  const setModel = (address: SpineAddress, model: string) => patchNode(address, { model });
  const setInputs = (inputs: WorkflowInputSpec[]) => patchDefinition({ inputs });
  const setIntegrations = (integrations: string[]) => patchDefinition({ integrations });

  const updateStep = (address: SpineAddress, stepIndex: number, step: WorkflowStep) => {
    const node = nodeAt(address);
    if (!node) {
      return;
    }
    patchNode(address, { steps: node.steps.map((s, i) => (i === stepIndex ? step : s)) });
  };

  const addStep = (address: SpineAddress, kind: WorkflowStepKind) => {
    const node = nodeAt(address);
    if (!node) {
      return;
    }
    markDirty();
    const steps = [...node.steps, createWorkflowStep(kind)];
    patchNode(address, { steps });
    setSelectedStep({ ...address, stepIndex: steps.length - 1 });
    setAddOpenAddress(null);
  };

  const duplicateStep = (address: SpineAddress, stepIndex: number) => {
    const node = nodeAt(address);
    if (!node) {
      return;
    }
    markDirty();
    const clone = JSON.parse(JSON.stringify(node.steps[stepIndex])) as WorkflowStep;
    patchNode(address, {
      steps: [...node.steps.slice(0, stepIndex + 1), clone, ...node.steps.slice(stepIndex + 1)],
    });
  };

  const deleteStep = (address: SpineAddress, stepIndex: number) => {
    const node = nodeAt(address);
    if (!node) {
      return;
    }
    markDirty();
    patchNode(address, { steps: node.steps.filter((_, i) => i !== stepIndex) });
    setSelectedStep(null);
  };

  const reorderStep = (address: SpineAddress, from: number, to: number) => {
    if (from === to) {
      return;
    }
    const node = nodeAt(address);
    if (!node) {
      return;
    }
    markDirty();
    patchNode(address, { steps: moveItem(node.steps, from, to) });
    setSelectedStep(null);
  };

  // --- Spine-entry / lane operations (L30 / D-031a) --------------------------

  const addAgentNode = () => {
    markDirty();
    const newNode: WorkflowAgentNode = { slot: nextAgentSlot(definition.agents), harness: "", model: "", steps: [] };
    patchDefinition({ agents: [...definition.agents, newNode] });
    setSetupTarget({ spineIndex: definition.agents.length, lane: "-" });
    setSelectedStep(null);
  };

  // "Add agent in parallel" (mock: addAgentInParallel) — parallelize the last
  // spine entry, or add a lane to it if it's already a group.
  const addAgentInParallel = () => {
    const lastIndex = definition.agents.length - 1;
    if (lastIndex < 0) {
      addAgentNode();
      return;
    }
    const lastEntry = definition.agents[lastIndex]!;
    const newNode: WorkflowAgentNode = { slot: nextAgentSlot(definition.agents), harness: "", model: "", steps: [] };
    markDirty();
    const nextAgents = isParallelGroup(lastEntry)
      ? addLaneToGroup(definition.agents, lastIndex, newNode)
      : parallelizeSpineEntry(definition.agents, lastIndex, newNode);
    patchDefinition({ agents: nextAgents });
    setSetupTarget({ spineIndex: lastIndex, lane: newNode.slot });
    setSelectedStep(null);
  };

  const parallelizeEntry = (spineIndex: number) => {
    const newNode: WorkflowAgentNode = { slot: nextAgentSlot(definition.agents), harness: "", model: "", steps: [] };
    markDirty();
    patchDefinition({ agents: parallelizeSpineEntry(definition.agents, spineIndex, newNode) });
    setSetupTarget({ spineIndex, lane: newNode.slot });
    setSelectedStep(null);
  };

  const addLane = (spineIndex: number) => {
    const newNode: WorkflowAgentNode = { slot: nextAgentSlot(definition.agents), harness: "", model: "", steps: [] };
    markDirty();
    patchDefinition({ agents: addLaneToGroup(definition.agents, spineIndex, newNode) });
    setSetupTarget({ spineIndex, lane: newNode.slot });
    setSelectedStep(null);
  };

  const removeLane = (spineIndex: number, lane: string) => {
    markDirty();
    patchDefinition({ agents: removeLaneFromGroup(definition.agents, spineIndex, lane) });
    setSetupTarget(null);
    setSelectedStep(null);
  };

  const deleteSpineEntry = (spineIndex: number) => {
    const entry = definition.agents[spineIndex];
    if (!entry) {
      return;
    }
    const removedCount = isParallelGroup(entry) ? entry.parallel.length : 1;
    if (totalAgentCount - removedCount <= 0) {
      return;
    }
    markDirty();
    patchDefinition({ agents: removeSpineEntry(definition.agents, spineIndex) });
    setSetupTarget(null);
    setSelectedStep(null);
  };

  const reorderSpineEntry = (from: number, to: number) => {
    if (from === to) {
      return;
    }
    markDirty();
    patchDefinition({ agents: moveItem(definition.agents, from, to) });
    setSetupTarget(null);
    setSelectedStep(null);
  };

  const reorderLane = (spineIndex: number, from: number, to: number) => {
    if (from === to) {
      return;
    }
    const entry = definition.agents[spineIndex];
    if (!entry || !isParallelGroup(entry)) {
      return;
    }
    markDirty();
    const parallel = moveItem(entry.parallel, from, to);
    patchDefinition({ agents: definition.agents.map((e, i) => (i === spineIndex ? { parallel } : e)) });
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

  /** The agent-node scope header, shared by a standalone node and a lane inside
   * a parallel group — only the reorder/delete wiring passed in differs. */
  const renderAgentHeader = (
    node: WorkflowAgentNode,
    address: SpineAddress,
    opts: {
      canMoveUp: boolean;
      canMoveDown: boolean;
      onMoveUp: () => void;
      onMoveDown: () => void;
      onDelete?: () => void;
      extraMenuItems?: (close: () => void) => React.ReactNode;
    },
  ) => (
    <WorkflowScopeHeader
      variant="initial"
      {...resolveAgentLabels(node.harness, node.model)}
      selected={setupTarget?.spineIndex === address.spineIndex && setupTarget.lane === address.lane}
      invalid={issues.some(
        (issue) => issue.location.scope === "agent" && issue.location.nodeIndex === nodeOrdinalFor(definition, address),
      )}
      canMoveUp={opts.canMoveUp}
      canMoveDown={opts.canMoveDown}
      onSelect={() => { setSetupTarget(address); setSelectedStep(null); }}
      onMoveUp={opts.onMoveUp}
      onMoveDown={opts.onMoveDown}
      onDelete={opts.onDelete}
      extraMenuItems={opts.extraMenuItems}
    />
  );

  /** The step list + add-step affordance for one agent node, addressed by
   * `address` — identical whether the node is standalone or a lane. */
  const renderAgentSteps = (node: WorkflowAgentNode, address: SpineAddress) => {
    let actionNumber = 0;
    return (
      <>
        {node.steps.map((step, stepIndex) => {
          const flatIndex = flatStepIndex(definition, address, stepIndex);
          const thisConfig = effectiveConfigs[flatIndex];
          const dragProps = {
            draggable: true,
            onDragStart: () => setDragKey({ ...address, stepIndex }),
            onDragOver: (event: DragEvent) => event.preventDefault(),
            onDrop: () => {
              if (dragKey !== null && dragKey.spineIndex === address.spineIndex && dragKey.lane === address.lane) {
                reorderStep(address, dragKey.stepIndex, stepIndex);
              }
              setDragKey(null);
            },
          } as const;
          const isSelected =
            selectedStep?.spineIndex === address.spineIndex
            && selectedStep.lane === address.lane
            && selectedStep.stepIndex === stepIndex;

          // Agent config is a SCOPE BOUNDARY, not a numbered action — render it
          // as a header/divider with no spine number. In v2 it only ever
          // switches the model (harness is fixed per node).
          if (step.kind === "agent.config") {
            const labels = resolveAgentLabels(
              thisConfig?.effectiveHarness ?? node.harness,
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
                  canMoveDown={stepIndex < node.steps.length - 1}
                  onSelect={() => { setSelectedStep({ ...address, stepIndex }); setSetupTarget(null); }}
                  onDuplicate={() => duplicateStep(address, stepIndex)}
                  onDelete={() => deleteStep(address, stepIndex)}
                  onMoveUp={() => reorderStep(address, stepIndex, stepIndex - 1)}
                  onMoveDown={() => reorderStep(address, stepIndex, stepIndex + 1)}
                />
              </div>
            );
          }

          // Real action — number it 1..N ignoring scope boundaries.
          actionNumber += 1;
          // Draw the spine only to the next contiguous action. When the next
          // step is a scope boundary (agent.config), the header is the clean
          // break, so the spine stops here.
          const nextIsAction =
            node.steps[stepIndex + 1] !== undefined && node.steps[stepIndex + 1]!.kind !== "agent.config";
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
                canMoveDown={stepIndex < node.steps.length - 1}
                onSelect={() => { setSelectedStep({ ...address, stepIndex }); setSetupTarget(null); }}
                onChange={(next) => updateStep(address, stepIndex, next)}
                onDuplicate={() => duplicateStep(address, stepIndex)}
                onDelete={() => deleteStep(address, stepIndex)}
                onMoveUp={() => reorderStep(address, stepIndex, stepIndex - 1)}
                onMoveDown={() => reorderStep(address, stepIndex, stepIndex + 1)}
              />
            </div>
          );
        })}

        <div className="flex justify-start pl-[6px]">
          <PopoverButton
            align="start"
            side="bottom"
            externalOpen={addOpenAddress?.spineIndex === address.spineIndex && addOpenAddress.lane === address.lane}
            onOpenChange={(open) => setAddOpenAddress(open ? address : null)}
            className={`w-48 ${POPOVER_SURFACE_CLASS}`}
            trigger={(
              <Button
                type="button"
                variant="unstyled"
                size="unstyled"
                aria-label="Add step"
                className="flex size-8 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm outline-none transition-colors hover:border-border-heavy hover:text-foreground data-[state=open]:border-border-heavy data-[state=open]:text-foreground"
              >
                <Plus className="size-4" />
              </Button>
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
                    onClick={() => { close(); addStep(address, kind); }}
                  />
                ))}
              </div>
            )}
          </PopoverButton>
        </div>
      </>
    );
  };

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
            {issues.length > 0 ? (
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

        <div className="grid min-h-0 flex-1 overflow-hidden transition-[grid-template-columns] duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] grid-cols-[1fr]" style={selectedStep !== null || setupTarget !== null ? { gridTemplateColumns: "1fr minmax(0, min(50%, 420px))" } : undefined}>
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
                localRepoOptions={localTriggerRepoOptions}
                onOpenRun={(runId) => navigate(`/workflows/${workflowId}/runs/${runId}`)}
              />

              {/* Agents as top-level rail items: a standalone node is its own
                  scope boundary (a harness/model header) with its steps nested
                  underneath; a parallel group (L30 / D-031a) is one spine
                  entry whose lanes render side-by-side, each with the same
                  per-agent header + nested steps. Switching agents = a new
                  node; switching model within a node = an inline agent.config
                  step. */}
              {definition.agents.map((entry, spineIndex) => {
                if (isParallelGroup(entry)) {
                  return (
                    <div key={spineIndex} className="flex flex-col">
                      <div
                        draggable
                        onDragStart={() => setDragSpineIndex(spineIndex)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => {
                          if (dragSpineIndex !== null) {
                            reorderSpineEntry(dragSpineIndex, spineIndex);
                          }
                          setDragSpineIndex(null);
                        }}
                        className="flex items-center gap-2 py-1.5"
                      >
                        <span className="text-xs font-medium text-foreground">Run together</span>
                        <span className="text-xs text-muted-foreground">
                          — every agent runs at once; a sibling always finishes before the run fails
                        </span>
                        <span aria-hidden className="h-px flex-1 bg-border" />
                        <PopoverButton
                          stopPropagation
                          align="end"
                          side="bottom"
                          className={`w-48 ${POPOVER_SURFACE_CLASS}`}
                          trigger={(
                            <Button variant="ghost" size="icon-sm" aria-label="Group options">
                              <MoreHorizontal className="size-4" />
                            </Button>
                          )}
                        >
                          {(close) => (
                            <div className="p-1">
                              <PopoverMenuItem
                                density="compact"
                                label="Add agent in parallel"
                                onClick={() => { close(); addLane(spineIndex); }}
                              />
                            </div>
                          )}
                        </PopoverButton>
                      </div>

                      <div className="flex flex-wrap items-start gap-3">
                        {entry.parallel.map((laneNode, laneIndex) => {
                          const address: SpineAddress = { spineIndex, lane: laneNode.slot };
                          return (
                            <div
                              key={laneNode.slot}
                              className="flex min-w-[260px] flex-1 flex-col"
                              draggable
                              onDragStart={() => setDragLane({ spineIndex, laneIndex })}
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={() => {
                                if (dragLane !== null && dragLane.spineIndex === spineIndex) {
                                  reorderLane(spineIndex, dragLane.laneIndex, laneIndex);
                                }
                                setDragLane(null);
                              }}
                            >
                              {renderAgentHeader(laneNode, address, {
                                canMoveUp: laneIndex > 0,
                                canMoveDown: laneIndex < entry.parallel.length - 1,
                                onMoveUp: () => reorderLane(spineIndex, laneIndex, laneIndex - 1),
                                onMoveDown: () => reorderLane(spineIndex, laneIndex, laneIndex + 1),
                                onDelete: () => removeLane(spineIndex, laneNode.slot),
                              })}
                              <div className="flex flex-col pl-4">{renderAgentSteps(laneNode, address)}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                }

                const address: SpineAddress = { spineIndex, lane: "-" };
                return (
                  <div key={spineIndex} className="flex flex-col">
                    <div
                      draggable
                      onDragStart={() => setDragSpineIndex(spineIndex)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => {
                        if (dragSpineIndex !== null) {
                          reorderSpineEntry(dragSpineIndex, spineIndex);
                        }
                        setDragSpineIndex(null);
                      }}
                    >
                      {renderAgentHeader(entry, address, {
                        canMoveUp: spineIndex > 0,
                        canMoveDown: spineIndex < definition.agents.length - 1,
                        onMoveUp: () => reorderSpineEntry(spineIndex, spineIndex - 1),
                        onMoveDown: () => reorderSpineEntry(spineIndex, spineIndex + 1),
                        onDelete: totalAgentCount > 1 ? () => deleteSpineEntry(spineIndex) : undefined,
                        extraMenuItems: (close) => (
                          <PopoverMenuItem
                            density="compact"
                            label="Add agent in parallel"
                            onClick={() => { close(); parallelizeEntry(spineIndex); }}
                          />
                        ),
                      })}
                    </div>

                    <div className="flex flex-col pl-4">{renderAgentSteps(entry, address)}</div>
                  </div>
                );
              })}

              <div className="flex items-center justify-start gap-2">
                <Button variant="secondary" size="sm" onClick={addAgentNode} disabled={totalAgentCount >= WORKFLOW_MAX_AGENTS}>
                  <Plus className="size-3.5" />
                  Add agent
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={addAgentInParallel}
                  disabled={totalAgentCount >= WORKFLOW_MAX_AGENTS || definition.agents.length === 0}
                >
                  <Plus className="size-3.5" />
                  In parallel with the last
                </Button>
              </div>
            </div>
          </div>

          {selectedStep !== null && nodeAt(selectedStep)?.steps[selectedStep.stepIndex] ? (
            <div className="overflow-hidden border-l border-border bg-background">
              <WorkflowStepPanel
                step={nodeAt(selectedStep)!.steps[selectedStep.stepIndex]!}
                effectiveHarness={nodeAt(selectedStep)!.harness}
                agents={agents}
                suggestions={suggestions}
                slackConnected={slackChannelsQuery.data?.connected ?? false}
                slackChannels={slackChannelsQuery.data?.channels ?? []}
                includableWorkflows={includableWorkflows}
                supportsGoals={harnessSupportsGoals}
                onChange={(next) => updateStep(selectedStep, selectedStep.stepIndex, next)}
                onClose={() => setSelectedStep(null)}
              />
            </div>
          ) : setupTarget !== null && nodeAt(setupTarget) ? (
            <div className="flex h-full flex-col overflow-hidden border-l border-border bg-background">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <span className="inline-flex select-none items-center gap-1.5 rounded-full border border-border bg-transparent px-3 py-0.5 text-xs font-medium leading-none text-foreground">
                  <Robot className="size-3.5 shrink-0 text-foreground" />
                  <span>Agent</span>
                </span>
                <Button variant="ghost" size="icon-sm" onClick={() => setSetupTarget(null)} aria-label="Close panel">
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
                        value={nodeAt(setupTarget)!.slot}
                        placeholder="agent_1"
                        className="font-mono"
                        onChange={(event) => patchNode(setupTarget, { slot: event.target.value })}
                      />
                    </div>
                  </div>
                  {(() => {
                    const slotIssue = issues.find(
                      (issue) =>
                        issue.location.scope === "agent" &&
                        issue.location.nodeIndex === nodeOrdinalFor(definition, setupTarget) &&
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
                        value={nodeAt(setupTarget)!.harness || ""}
                        placeholder="Select agent"
                        options={agents.map((agent) => ({ value: agent.kind, label: agent.displayName }))}
                        onChange={(harness) => {
                          markDirty();
                          const next = agents.find((agent) => agent.kind === harness);
                          patchNode(setupTarget, { harness, model: next?.models[0]?.id ?? "" });
                        }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="w-28 shrink-0 text-sm text-muted-foreground">Model</span>
                    <div className="flex flex-1 justify-end">
                      <WorkflowSelect
                        ariaLabel="Model"
                        value={nodeAt(setupTarget)!.model || ""}
                        placeholder="Select model"
                        disabled={(agents.find((a) => a.kind === nodeAt(setupTarget)!.harness)?.models ?? []).length === 0}
                        options={(agents.find((a) => a.kind === nodeAt(setupTarget)!.harness)?.models ?? []).map((model) => ({ value: model.id, label: model.label }))}
                        onChange={(model) => setModel(setupTarget, model)}
                      />
                    </div>
                  </div>
                  {definition.integrations.length > 0 ? (
                    <div className="border-t border-border/60 pt-3">
                      <WorkflowAgentIntegrationsRow
                        workflowIntegrations={definition.integrations}
                        displayNames={functionProviderDisplayNames}
                        value={nodeAt(setupTarget)!.integrations}
                        onChange={(next) => {
                          markDirty();
                          patchNode(setupTarget, { integrations: next });
                        }}
                      />
                    </div>
                  ) : null}
                  {setupTarget.lane !== "-" && isParallelGroup(definition.agents[setupTarget.spineIndex]!) ? (
                    <div className="flex flex-col gap-1.5 border-t border-border pt-4">
                      <p className="text-xs text-muted-foreground">
                        A lane in a "Run together" group — it runs concurrently with{" "}
                        {(definition.agents[setupTarget.spineIndex] as WorkflowParallelGroup).parallel.length - 1}{" "}
                        other agent(s); all lanes join before the run continues.
                      </p>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="self-start"
                        onClick={() => removeLane(setupTarget.spineIndex, setupTarget.lane)}
                      >
                        Remove from group
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </MainSidebarPageShell>
  );
}
