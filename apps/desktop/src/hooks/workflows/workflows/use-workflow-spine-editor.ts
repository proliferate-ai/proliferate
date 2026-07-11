import {
  createWorkflowStep,
  isParallelGroup,
  type WorkflowAgentNode,
  type WorkflowDefinition,
  type WorkflowStep,
  type WorkflowStepKind,
} from "@proliferate/product-domain/workflows/definition";
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

function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item!);
  return copy;
}

export interface UseWorkflowSpineEditorDeps {
  definition: WorkflowDefinition | null;
  totalAgentCount: number;
  patchDefinition: (next: Partial<WorkflowDefinition>) => void;
  markDirty: () => void;
  setSetupTarget: (address: SpineAddress | null) => void;
  setSelectedStep: (step: (SpineAddress & { stepIndex: number }) | null) => void;
}

/**
 * Spine/step mutation operations for the workflow editor draft (split out of
 * `use-workflow-editor-draft.ts`, WS0B-U, to keep both hook files under the
 * frontend line-count guidance). Every operation guards on `definition` being
 * loaded — the caller (the draft hook) runs this unconditionally alongside
 * its other hooks, before its own null check gates rendering.
 */
export function useWorkflowSpineEditor({
  definition,
  totalAgentCount,
  patchDefinition,
  markDirty,
  setSetupTarget,
  setSelectedStep,
}: UseWorkflowSpineEditorDeps) {
  const nodeAt = (address: SpineAddress) => (definition ? getSpineNode(definition.agents, address) : undefined);

  const patchNode = (address: SpineAddress, next: Partial<WorkflowAgentNode>) => {
    if (!definition) return;
    patchDefinition({ agents: withSpineNode(definition.agents, address, (n) => ({ ...n, ...next })) });
  };

  const setModel = (address: SpineAddress, model: string) => patchNode(address, { model });

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
    if (!definition) return;
    markDirty();
    const newNode: WorkflowAgentNode = { slot: nextAgentSlot(definition.agents), harness: "", model: "", steps: [] };
    patchDefinition({ agents: [...definition.agents, newNode] });
    setSetupTarget({ spineIndex: definition.agents.length, lane: "-" });
    setSelectedStep(null);
  };

  // "Add agent in parallel" (mock: addAgentInParallel) — parallelize the last
  // spine entry, or add a lane to it if it's already a group.
  const addAgentInParallel = () => {
    if (!definition) return;
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
    if (!definition) return;
    const newNode: WorkflowAgentNode = { slot: nextAgentSlot(definition.agents), harness: "", model: "", steps: [] };
    markDirty();
    patchDefinition({ agents: parallelizeSpineEntry(definition.agents, spineIndex, newNode) });
    setSetupTarget({ spineIndex, lane: newNode.slot });
    setSelectedStep(null);
  };

  const addLane = (spineIndex: number) => {
    if (!definition) return;
    const newNode: WorkflowAgentNode = { slot: nextAgentSlot(definition.agents), harness: "", model: "", steps: [] };
    markDirty();
    patchDefinition({ agents: addLaneToGroup(definition.agents, spineIndex, newNode) });
    setSetupTarget({ spineIndex, lane: newNode.slot });
    setSelectedStep(null);
  };

  const removeLane = (spineIndex: number, lane: string) => {
    if (!definition) return;
    markDirty();
    patchDefinition({ agents: removeLaneFromGroup(definition.agents, spineIndex, lane) });
    setSetupTarget(null);
    setSelectedStep(null);
  };

  const deleteSpineEntry = (spineIndex: number) => {
    if (!definition) return;
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
    if (from === to || !definition) {
      return;
    }
    markDirty();
    patchDefinition({ agents: moveItem(definition.agents, from, to) });
    setSetupTarget(null);
    setSelectedStep(null);
  };

  const reorderLane = (spineIndex: number, from: number, to: number) => {
    if (from === to || !definition) {
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

  return {
    nodeAt,
    patchNode,
    setModel,
    updateStep,
    addStep,
    duplicateStep,
    deleteStep,
    reorderStep,
    addAgentNode,
    addAgentInParallel,
    parallelizeEntry,
    addLane,
    removeLane,
    deleteSpineEntry,
    reorderSpineEntry,
    reorderLane,
  };
}
