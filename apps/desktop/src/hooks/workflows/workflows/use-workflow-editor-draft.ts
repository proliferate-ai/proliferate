import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  isParallelGroup,
  serializeWorkflowDefinition,
  spineAgentNodes,
  type AgentEmitStep,
  type WorkflowAgentNode,
  type WorkflowDefinition,
  type WorkflowInputSpec,
} from "@proliferate/product-domain/workflows/definition";
import { templateSuggestions } from "@proliferate/product-domain/workflows/interpolation";
import { WORKFLOW_STEP_META } from "@proliferate/product-domain/workflows/presentation";
import { parseWorkflowDefinitionResult } from "@proliferate/product-domain/workflows/read-only";
import { validateWorkflowDefinition } from "@proliferate/product-domain/workflows/validation";
import type { SpineAddress } from "@proliferate/product-domain/workflows/spine-editing";
import { useWorkflowDetail } from "@/hooks/access/cloud/workflows/use-workflows";
import { useWorkflowMutations } from "@/hooks/access/cloud/workflows/use-workflow-mutations";
import { ensureDefinitionIds } from "@/lib/domain/workflows/drag-identity";
import { harnessSupportsGoals } from "@/lib/domain/workflows/goal-capability";
import { useWorkflowSpineEditor } from "./use-workflow-spine-editor";

/** Why a stored definition can't be edited by this client (feature spec §5.1). */
export interface WorkflowUnsupported {
  reason: "version" | "step_kind";
  version: unknown;
}

interface Draft {
  name: string;
  description: string;
  definition: WorkflowDefinition;
}

const EMPTY_NODE: WorkflowAgentNode = { slot: "main", harness: "", model: "", steps: [] };

/** The output_schema's top-level property names, or `[]` when not an object schema. */
function emitOutputSchemaFields(outputSchema: Record<string, unknown>): string[] {
  const properties = outputSchema.properties;
  return properties && typeof properties === "object" && !Array.isArray(properties)
    ? Object.keys(properties as Record<string, unknown>)
    : [];
}

/**
 * Draft/dirty/save/duplicate/issues/selection orchestration for the workflow
 * editor (WS0B-U split of `WorkflowEditorScreen.tsx`). Owns the whole
 * draft-mutation cluster — spine editing, step CRUD, save/duplicate — so the
 * screen and its rendering pieces (setup inspector, agent inspector, spine
 * canvas) stay render-only.
 *
 * The hook body runs unconditionally (rules of hooks), so every mutator below
 * guards on `definition === null` instead of relying on an earlier render's
 * null check the way the pre-split component body did.
 */
export function useWorkflowEditorDraft(workflowId: string) {
  const navigate = useNavigate();
  const detailQuery = useWorkflowDetail(workflowId);
  const { updateMutation, createMutation } = useWorkflowMutations();

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
  // Drag state is keyed by stable draft object IDs (feature spec §5.1 / §12),
  // never by array index or editable slot label: a lane rename or concurrent
  // reorder mid-drag can never land a drop on the wrong node. The IDs resolve to
  // a CURRENT address/index at drop time (drag-identity.ts).
  const [dragStepId, setDragStepId] = useState<string | null>(null);
  const [dragEntryId, setDragEntryId] = useState<string | null>(null);
  const [dragLaneId, setDragLaneId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Tracks edits made since the last load/save, independent of `saved` (which
  // only flips true right after a successful save) — drives the header's
  // "Unsaved changes" vs "Saved" status line.
  const [dirty, setDirty] = useState(false);
  // Surfaces a save/create mutation's rejection (e.g. a server-side name-length
  // 400) right next to the Save button — previously a failed mutation just
  // stopped the spinner with no feedback. Cleared on the next edit or success.
  const [saveError, setSaveError] = useState<string | null>(null);
  // An unsupported (unknown version / unknown step kind) stored definition is
  // rendered read-only; the editor never drops unknown data or saves a truncated
  // definition (feature spec §5.1, WS9b item 6).
  const [unsupported, setUnsupported] = useState<WorkflowUnsupported | null>(null);

  // Seed the draft once the detail loads. A brand-new / empty definition has
  // no agent node yet — seed one so the editor always has a slot to edit. Every
  // slot/node/group/lane/step gets a stable draft ID (drag/keys use IDs, §5.1).
  useEffect(() => {
    if (draft !== null || unsupported !== null || !detailQuery.data) {
      return;
    }
    const name = detailQuery.data.workflow.name;
    const description = detailQuery.data.workflow.description ?? "";
    const raw = detailQuery.data.currentVersion?.definition ?? null;
    if (raw === null) {
      const definition: WorkflowDefinition = { version: 1, inputs: [], integrations: [], agents: [{ ...EMPTY_NODE }] };
      setDraft({ name, description, definition: ensureDefinitionIds(definition) });
      return;
    }
    const parsed = parseWorkflowDefinitionResult(raw);
    if (parsed.kind === "unsupported") {
      setUnsupported({ reason: parsed.reason, version: parsed.version });
      return;
    }
    const definition: WorkflowDefinition =
      parsed.definition.agents.length > 0
        ? parsed.definition
        : { ...parsed.definition, agents: [{ ...EMPTY_NODE }] };
    setDraft({ name, description, definition: ensureDefinitionIds(definition) });
  }, [draft, unsupported, detailQuery.data]);

  // Seeds (track 1f starter templates) are shared, org-agnostic rows: viewable
  // and runnable, but never editable in place. The editor opens read-only and
  // offers "Duplicate" — a real owned copy the user can then customize.
  const isSeed = detailQuery.data?.workflow.isSeed ?? false;

  const definition = draft?.definition ?? null;

  const issues = useMemo(
    () =>
      draft
        ? validateWorkflowDefinition(draft.definition, {
            harnessSupportsGoals,
            workflowId,
          })
        : [],
    [draft, workflowId],
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

  const totalAgentCount = definition ? spineAgentNodes(definition).length : 0;
  const nameInvalid = (draft?.name ?? "").trim() === "";
  const canSave = draft !== null && !isSeed && !nameInvalid && issues.length === 0 && !updateMutation.isPending;

  const markDirty = () => {
    setSaved(false);
    setDirty(true);
    setSaveError(null);
  };

  const patchDefinition = (next: Partial<WorkflowDefinition>) => {
    markDirty();
    setDraft((prev) => (prev ? { ...prev, definition: { ...prev.definition, ...next } } : prev));
  };

  const spineEditor = useWorkflowSpineEditor({
    definition,
    totalAgentCount,
    patchDefinition,
    markDirty,
    setSetupTarget,
    setSelectedStep,
  });

  const setInputs = (inputs: WorkflowInputSpec[]) => patchDefinition({ inputs });
  const setIntegrations = (integrations: string[]) => patchDefinition({ integrations });
  const setName = (name: string) => {
    markDirty();
    setDraft((prev) => (prev ? { ...prev, name } : prev));
  };
  const setDescription = (description: string) => {
    markDirty();
    setDraft((prev) => (prev ? { ...prev, description } : prev));
  };

  const handleSave = () => {
    if (!draft) return;
    updateMutation.mutate(
      {
        workflowId,
        body: {
          name: draft.name,
          description: draft.description || undefined,
          definition: serializeWorkflowDefinition(draft.definition),
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
    if (!draft) return;
    createMutation.mutate(
      {
        name: `${draft.name} (copy)`,
        description: draft.description || undefined,
        definition: serializeWorkflowDefinition(draft.definition),
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

  return {
    detailQuery,
    isSeed,
    unsupported,
    draft,
    definition,
    totalAgentCount,
    nameInvalid,
    canSave,
    dirty,
    saved,
    saveError,
    issues,
    suggestions,
    selectedStep,
    setSelectedStep,
    setupTarget,
    setSetupTarget,
    setupOpen,
    setSetupOpen,
    dragStepId,
    setDragStepId,
    dragEntryId,
    setDragEntryId,
    dragLaneId,
    setDragLaneId,
    isSaving: updateMutation.isPending,
    isDuplicating: createMutation.isPending,
    markDirty,
    setName,
    setDescription,
    setInputs,
    setIntegrations,
    ...spineEditor,
    handleSave,
    duplicateSeed,
  };
}
