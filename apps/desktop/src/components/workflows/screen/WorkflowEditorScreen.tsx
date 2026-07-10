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
import { ArrowLeft, CircleAlert, MoreHorizontal, Play, Plus, Robot, X } from "@proliferate/ui/icons";
import {
  POPOVER_SURFACE_CLASS,
  PopoverButton,
} from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { EmptyState } from "@proliferate/ui/layout/EmptyState";
import { useCloudAgentCatalog } from "@/hooks/access/cloud/agent-catalog/use-cloud-agent-catalog";
import { useCloudRunTargetWorkspaces } from "@/hooks/access/cloud/workspaces/use-cloud-run-target-workspaces";
import { useWorkflowDetail, useWorkflows } from "@/hooks/access/cloud/workflows/use-workflows";
import { useWorkflowMutations } from "@/hooks/access/cloud/workflows/use-workflow-mutations";
import { useWorkflowSlackChannels } from "@/hooks/access/cloud/workflows/use-workflow-slack-channels";
import { useCloudIntegrations } from "@/hooks/cloud/facade/use-cloud-integrations";
import { useFunctionInvocations } from "@/hooks/access/cloud/integrations/use-function-invocations";
import { useActiveOrganization } from "@/hooks/organizations/facade/use-active-organization";
import { useWorkspaces } from "@/hooks/workspaces/cache/use-workspaces";
import { buildLocalAutomationRepoCandidates } from "@/lib/domain/automations/local-executor/plan";
import { harnessSupportsGoals } from "@/lib/domain/workflows/goal-capability";
import { WorkflowMetaCard } from "../editor/WorkflowMetaCard";
import { WorkflowSetupCard } from "../editor/WorkflowSetupCard";
import {
  WorkflowTriggersCard,
  type WorkflowTriggerRepoOption,
} from "../editor/WorkflowTriggersCard";
import {
  WorkflowAgentIntegrationsRow,
  WorkflowFunctionsCard,
  type WorkflowFunctionProviderOption,
} from "../editor/WorkflowFunctionsCard";
import {
  WorkflowAddStepButton,
  WorkflowAgentBlockCard,
  WorkflowSpineConnector,
  WorkflowStepRow,
} from "../editor/WorkflowAgentBlockCard";
import { WorkflowStepPanel, type EditorAgent } from "../editor/WorkflowStepPanel";
import { WorkflowSelect } from "../editor/WorkflowSelect";
import { IntegrationIcon } from "@/components/settings/panes/integrations/IntegrationIcon";
import { useWorkflowTriggers } from "@/hooks/access/cloud/workflows/use-workflow-triggers";
import { useWorkflowRunLauncher } from "@/hooks/access/cloud/workflows/use-workflow-run-launcher";

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
  const functionInvocationsQuery = useFunctionInvocations();
  const { updateMutation, createMutation } = useWorkflowMutations();
  const launcher = useWorkflowRunLauncher();
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

  // Seeds (track 1f starter templates) are shared, org-agnostic rows: viewable
  // and runnable, but never editable in place. The editor opens read-only and
  // offers "Duplicate" — a real owned copy the user can then customize.
  const isSeed = detailQuery.data?.workflow.isSeed ?? false;

  const [draft, setDraft] = useState<Draft | null>(null);
  // Selection is addressed by (spineIndex, lane, stepIndex) — agents are
  // top-level rail items, each with its own nested steps; a parallel group
  // (L30 / D-031a) is one spine entry whose lanes are addressed by their slot
  // (lane "-" for a standalone node).
  const [selectedStep, setSelectedStep] = useState<(SpineAddress & { stepIndex: number }) | null>(null);
  const [setupTarget, setSetupTarget] = useState<SpineAddress | null>(null);
  // The setup inspector (name/description/inputs/integrations/triggers) —
  // opened by clicking the canvas summary card, mutually exclusive with the
  // step and agent inspectors. Open on load: naming the workflow is the first
  // edit, and the T2-WF editor spec expects the name field visible on entry.
  const [setupOpen, setSetupOpen] = useState(true);
  const [dragKey, setDragKey] = useState<(SpineAddress & { stepIndex: number }) | null>(null);
  const [dragSpineIndex, setDragSpineIndex] = useState<number | null>(null);
  const [dragLane, setDragLane] = useState<{ spineIndex: number; laneIndex: number } | null>(null);
  const [saved, setSaved] = useState(false);
  // Tracks edits made since the last load/save, independent of `saved` (which
  // only flips true right after a successful save) — drives the header's
  // "Unsaved changes" vs "Saved" status line.
  const [dirty, setDirty] = useState(false);
  // Surfaces a save/create mutation's rejection (e.g. a server-side name-length
  // 400) right next to the Save button — previously a failed mutation just
  // stopped the spinner with no feedback. Cleared on the next edit or success.
  const [saveError, setSaveError] = useState<string | null>(null);

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
    setSaveError(null);
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
          setSaveError(null);
        },
        onError: (error) => {
          setSaveError(error.message);
        },
      },
    );
  };

  const duplicateSeed = () => {
    createMutation.mutate(
      {
        name: `${draft.name} (copy)`,
        description: draft.description || undefined,
        definition: serializeWorkflowDefinition(definition),
      },
      {
        onSuccess: (detail) => {
          setSaveError(null);
          navigate(`/workflows/${detail.workflow.id}/edit`);
        },
        onError: (error) => {
          setSaveError(error.message);
        },
      },
    );
  };

  const nameInvalid = draft.name.trim() === "";
  const canSave = !isSeed && !nameInvalid && issues.length === 0 && !updateMutation.isPending;

  // Resolve a node's model id to its catalog display label. Falls back to the
  // raw id when not in the catalog (e.g. a probe-only variant).
  const resolveModelLabel = (harnessKind: string, modelId: string) => {
    const agent = agents.find((a) => a.kind === harnessKind);
    return agent?.models.find((m) => m.id === modelId)?.label ?? modelId ?? "";
  };

  // The routed-connector summary after a standalone agent: its branch step's
  // taken (continue) case + the values that end the run, in plain English.
  const routeAfter = (node: WorkflowAgentNode): { taken: string; others?: string } | null => {
    const branch = node.steps.find((step) => step.kind === "branch");
    if (!branch || branch.kind !== "branch" || !branch.on) {
      return null;
    }
    const taken = Object.entries(branch.cases).find(([, c]) => c.to === "continue");
    if (!taken) {
      return null;
    }
    const ends = Object.entries(branch.cases)
      .filter(([, c]) => c.to === "end")
      .map(([value]) => `"${value}"`);
    return {
      taken: `${branch.on} is "${taken[0]}"`,
      others: ends.length > 0 ? `${ends.join(", ")} ends the run` : undefined,
    };
  };

  const agentMenu = (
    address: SpineAddress,
    opts: {
      canMoveUp: boolean;
      canMoveDown: boolean;
      onMoveUp: () => void;
      onMoveDown: () => void;
      onDelete?: () => void;
      onAddParallel: () => void;
    },
  ) => (
    <PopoverButton
      stopPropagation
      align="end"
      side="bottom"
      className={`w-52 ${POPOVER_SURFACE_CLASS}`}
      trigger={(
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          aria-label="Agent actions"
          className="shrink-0 rounded p-0.5 text-faint transition-colors hover:bg-surface-elevated-secondary hover:text-muted-foreground"
        >
          <MoreHorizontal className="size-3.5" />
        </Button>
      )}
    >
      {(close) => (
        <div className="p-1">
          <PopoverMenuItem
            density="compact"
            label="Edit"
            onClick={() => { close(); setSetupTarget(address); setSelectedStep(null); setSetupOpen(false); }}
          />
          <PopoverMenuItem density="compact" label="Add agent in parallel" onClick={() => { close(); opts.onAddParallel(); }} />
          <PopoverMenuItem density="compact" label="Move up" disabled={!opts.canMoveUp} onClick={() => { close(); opts.onMoveUp(); }} />
          <PopoverMenuItem density="compact" label="Move down" disabled={!opts.canMoveDown} onClick={() => { close(); opts.onMoveDown(); }} />
          {opts.onDelete ? (
            <PopoverMenuItem
              density="compact"
              label="Delete agent"
              labelClassName="text-destructive"
              onClick={() => { close(); opts.onDelete!(); }}
            />
          ) : null}
        </div>
      )}
    </PopoverButton>
  );

  /** One agent node as a block card: header (slot/model → agent inspector) +
   * single-line step rows + the add-step affordance. Identical for a
   * standalone node and a lane; only the menu wiring differs. */
  const renderAgentBlock = (
    node: WorkflowAgentNode,
    address: SpineAddress,
    menu: React.ReactNode,
  ) => {
    const agentInvalid = issues.some(
      (issue) => issue.location.scope === "agent" && issue.location.nodeIndex === nodeOrdinalFor(definition, address),
    );
    return (
      <WorkflowAgentBlockCard
        node={node}
        modelLabel={resolveModelLabel(node.harness, node.model)}
        selected={setupTarget?.spineIndex === address.spineIndex && setupTarget.lane === address.lane}
        invalid={agentInvalid}
        onSelect={() => { setSetupTarget(address); setSelectedStep(null); setSetupOpen(false); }}
        menu={menu}
      >
        {node.steps.map((step, stepIndex) => {
          const flatIndex = flatStepIndex(definition, address, stepIndex);
          const isSelected =
            selectedStep?.spineIndex === address.spineIndex
            && selectedStep.lane === address.lane
            && selectedStep.stepIndex === stepIndex;
          return (
            <div
              key={stepIndex}
              draggable
              onDragStart={() => setDragKey({ ...address, stepIndex })}
              onDragOver={(event: DragEvent) => event.preventDefault()}
              onDrop={() => {
                if (dragKey !== null && dragKey.spineIndex === address.spineIndex && dragKey.lane === address.lane) {
                  reorderStep(address, dragKey.stepIndex, stepIndex);
                }
                setDragKey(null);
              }}
            >
              <WorkflowStepRow
                step={step}
                selected={isSelected}
                invalid={stepIssues(issues, flatIndex).length > 0}
                canMoveUp={stepIndex > 0}
                canMoveDown={stepIndex < node.steps.length - 1}
                onSelect={() => { setSelectedStep({ ...address, stepIndex }); setSetupTarget(null); setSetupOpen(false); }}
                onMove={(dir) => reorderStep(address, stepIndex, stepIndex + dir)}
                onDuplicate={() => duplicateStep(address, stepIndex)}
                onDelete={() => deleteStep(address, stepIndex)}
              />
            </div>
          );
        })}
        <WorkflowAddStepButton kinds={STEP_KINDS} onAdd={(kind) => addStep(address, kind)} />
      </WorkflowAgentBlockCard>
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
            {isSeed ? (
              <>
                <span className="text-xs text-muted-foreground">
                  Starter template · read-only
                </span>
                <Button
                  size="sm"
                  onClick={duplicateSeed}
                  loading={createMutation.isPending}
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
            ) : dirty ? (
              <span className="text-xs text-muted-foreground">Unsaved changes</span>
            ) : saved ? (
              <span className="text-xs font-medium text-success">Saved</span>
            ) : null}
            {saveError ? (
              <span className="max-w-[220px] truncate text-xs text-destructive" title={saveError}>
                {saveError}
              </span>
            ) : null}
            {isSeed ? null : (
              <Button size="sm" variant="secondary" onClick={handleSave} loading={updateMutation.isPending} disabled={!canSave}>
                Save
              </Button>
            )}
            <Button
              size="sm"
              disabled={issues.length > 0 || dirty}
              title={dirty ? "Save your changes first" : issues.length > 0 ? "Fix the issues first" : undefined}
              onClick={() => {
                if (detailQuery.data) {
                  launcher.open(detailQuery.data.workflow, definition);
                }
              }}
            >
              <Play className="size-3.5" />
              Run
            </Button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 overflow-hidden transition-[grid-template-columns] duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] grid-cols-[1fr]" style={selectedStep !== null || setupTarget !== null || setupOpen ? { gridTemplateColumns: "1fr minmax(0, min(50%, 420px))" } : undefined}>
          <div
            className="min-w-0 overflow-y-auto bg-[radial-gradient(circle_at_1px_1px,var(--color-border)_1px,transparent_0)] [background-size:16px_16px]"
          >
            <div className="mx-auto flex max-w-2xl flex-col px-6 py-6">
              {/* Setup summary card (editor page of record): title, description,
                  input + integration facts at a glance; clicking opens the setup
                  inspector where the actual editing lives. */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => { setSetupOpen(true); setSetupTarget(null); setSelectedStep(null); }}
                className={`mb-4 flex cursor-pointer flex-col gap-2 rounded-xl border bg-background p-3 shadow-sm transition-colors ${
                  setupOpen ? "border-border-heavy" : "border-border hover:border-border-heavy"
                }`}
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-foreground">{draft.name || "Untitled workflow"}</span>
                  {draft.description ? (
                    <span className="text-xs text-muted-foreground" data-telemetry-mask>{draft.description}</span>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-20 shrink-0 text-xs font-medium text-muted-foreground">Inputs</span>
                  {definition.inputs.length > 0 ? (
                    definition.inputs.map((input) => (
                      <span
                        key={input.name}
                        className="inline-flex shrink-0 select-none items-center gap-1 rounded-full bg-surface-elevated-secondary px-2 py-0.5 font-mono text-xs leading-4 text-muted-foreground"
                      >
                        {input.name || "…"}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-faint">none</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-20 shrink-0 text-xs font-medium text-muted-foreground">Integrations</span>
                  {definition.integrations.length > 0 ? (
                    definition.integrations.map((namespace) => (
                      <span key={namespace} className="inline-flex items-center gap-1.5">
                        <IntegrationIcon namespace={namespace} className="size-4 rounded" />
                        <span className="text-xs text-muted-foreground">
                          {functionProviderDisplayNames.get(namespace) ?? namespace}
                        </span>
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-faint">none</span>
                  )}
                </div>
                {triggerChips.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-20 shrink-0 text-xs font-medium text-muted-foreground">Triggers</span>
                    {triggerChips.map((chip) => (
                      <span
                        key={chip}
                        className="inline-flex shrink-0 select-none items-center gap-1 rounded-full bg-surface-elevated-secondary px-2 py-0.5 text-xs leading-4 text-muted-foreground"
                      >
                        {chip}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>

              {/* Spine: agent block cards joined by connectors; a routed branch
                  in the entry above summarizes its taken case on the connector.
                  A parallel group is one framed entry whose lanes render
                  side-by-side inside it. */}
              {definition.agents.map((entry, spineIndex) => {
                const previous = spineIndex > 0 ? definition.agents[spineIndex - 1] : null;
                const connector =
                  spineIndex > 0 ? (
                    <WorkflowSpineConnector
                      route={previous && !isParallelGroup(previous) ? routeAfter(previous) : null}
                    />
                  ) : null;

                if (isParallelGroup(entry)) {
                  return (
                    <div key={spineIndex} className="contents">
                      {connector}
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
                        className="flex flex-col rounded-xl border border-border bg-surface-elevated-secondary/20 transition-colors hover:border-border-heavy"
                      >
                        <div className="flex min-w-0 items-center gap-2 px-3.5 py-2">
                          <span className="text-sm font-medium text-foreground">Run together</span>
                          <span className="min-w-0 truncate text-xs text-muted-foreground">
                            continue once all finish, even if one fails
                          </span>
                          <span className="min-w-0 flex-1" />
                          <PopoverButton
                            stopPropagation
                            align="end"
                            side="bottom"
                            className={`w-48 ${POPOVER_SURFACE_CLASS}`}
                            trigger={(
                              <Button
                                type="button"
                                variant="unstyled"
                                size="unstyled"
                                aria-label="Group actions"
                                className="shrink-0 rounded p-0.5 text-faint transition-colors hover:bg-surface-elevated-secondary hover:text-muted-foreground"
                              >
                                <MoreHorizontal className="size-3.5" />
                              </Button>
                            )}
                          >
                            {(close) => (
                              <div className="p-1">
                                <PopoverMenuItem
                                  density="compact"
                                  label="Add parallel agent"
                                  onClick={() => { close(); addLane(spineIndex); }}
                                />
                                <PopoverMenuItem
                                  density="compact"
                                  label="Move up"
                                  disabled={spineIndex <= 0}
                                  onClick={() => { close(); reorderSpineEntry(spineIndex, spineIndex - 1); }}
                                />
                                <PopoverMenuItem
                                  density="compact"
                                  label="Move down"
                                  disabled={spineIndex >= definition.agents.length - 1}
                                  onClick={() => { close(); reorderSpineEntry(spineIndex, spineIndex + 1); }}
                                />
                              </div>
                            )}
                          </PopoverButton>
                        </div>
                        <div className="flex gap-2 px-2 pb-2">
                          {entry.parallel.map((laneNode, laneIndex) => {
                            const address: SpineAddress = { spineIndex, lane: laneNode.slot };
                            return (
                              <div
                                key={laneNode.slot}
                                className="flex min-w-[240px] flex-1 flex-col"
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
                                {renderAgentBlock(laneNode, address, agentMenu(address, {
                                  canMoveUp: laneIndex > 0,
                                  canMoveDown: laneIndex < entry.parallel.length - 1,
                                  onMoveUp: () => reorderLane(spineIndex, laneIndex, laneIndex - 1),
                                  onMoveDown: () => reorderLane(spineIndex, laneIndex, laneIndex + 1),
                                  onDelete: () => removeLane(spineIndex, laneNode.slot),
                                  onAddParallel: () => addLane(spineIndex),
                                }))}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                }

                const address: SpineAddress = { spineIndex, lane: "-" };
                return (
                  <div key={spineIndex} className="contents">
                    {connector}
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
                      {renderAgentBlock(entry, address, agentMenu(address, {
                        canMoveUp: spineIndex > 0,
                        canMoveDown: spineIndex < definition.agents.length - 1,
                        onMoveUp: () => reorderSpineEntry(spineIndex, spineIndex - 1),
                        onMoveDown: () => reorderSpineEntry(spineIndex, spineIndex + 1),
                        onDelete: totalAgentCount > 1 ? () => deleteSpineEntry(spineIndex) : undefined,
                        onAddParallel: () => parallelizeEntry(spineIndex),
                      }))}
                    </div>
                  </div>
                );
              })}

              {/* Add-agent verbs (mock: quiet pill buttons under the spine). */}
              <div className="flex items-center justify-center gap-2 py-3">
                <Button
                  type="button"
                  variant="unstyled"
                  size="unstyled"
                  onClick={addAgentNode}
                  disabled={totalAgentCount >= WORKFLOW_MAX_AGENTS}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground shadow-sm transition-colors hover:border-border-heavy hover:text-foreground disabled:opacity-50"
                >
                  <Plus className="size-3" />
                  Agent below
                </Button>
                <Button
                  type="button"
                  variant="unstyled"
                  size="unstyled"
                  onClick={addAgentInParallel}
                  disabled={totalAgentCount >= WORKFLOW_MAX_AGENTS || definition.agents.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground shadow-sm transition-colors hover:border-border-heavy hover:text-foreground disabled:opacity-50"
                >
                  <Plus className="size-3" />
                  In parallel with the last
                </Button>
              </div>
            </div>
          </div>

          {setupOpen ? (
            <div className="flex h-full flex-col overflow-hidden border-l border-border bg-background">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <span className="inline-flex select-none items-center gap-1.5 rounded-full border border-border bg-transparent px-3 py-0.5 text-xs font-medium leading-none text-foreground">
                  Setup
                </span>
                <Button variant="ghost" size="icon-sm" onClick={() => setSetupOpen(false)} aria-label="Close panel">
                  <X className="size-4" />
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <div className="flex flex-col gap-3">
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
                </div>
              </div>
            </div>
          ) : selectedStep !== null && nodeAt(selectedStep)?.steps[selectedStep.stepIndex] ? (
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
      {launcher.modal}
    </MainSidebarPageShell>
  );
}
