import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createWorkflowStep,
  parseWorkflowDefinition,
  serializeWorkflowDefinition,
  type WorkflowArgSpec,
  type WorkflowDefinition,
  type WorkflowSetup,
  type WorkflowStep,
  type WorkflowStepKind,
} from "@proliferate/product-domain/workflows/definition";
import { templateSuggestions } from "@proliferate/product-domain/workflows/interpolation";
import { WORKFLOW_STEP_META } from "@proliferate/product-domain/workflows/presentation";
import { stepIssues, validateWorkflowDefinition } from "@proliferate/product-domain/workflows/validation";
import { MainSidebarPageShell } from "@/components/workspace/shell/screen/MainSidebarPageShell";
import { Button } from "@proliferate/ui/primitives/Button";
import { Spinner } from "@proliferate/ui/primitives/Spinner";
import { ArrowLeft, Plus } from "@proliferate/ui/icons";
import { EmptyState } from "@proliferate/ui/layout/EmptyState";
import { useCloudAgentCatalog } from "@/hooks/access/cloud/agent-catalog/use-cloud-agent-catalog";
import { useWorkflowDetail } from "@/hooks/access/cloud/workflows/use-workflows";
import { useWorkflowMutations } from "@/hooks/access/cloud/workflows/use-workflow-mutations";
import { harnessSupportsGoals } from "@/lib/domain/workflows/goal-capability";
import { WorkflowMetaCard } from "../editor/WorkflowMetaCard";
import { WorkflowSetupCard } from "../editor/WorkflowSetupCard";
import { WorkflowTriggersCard } from "../editor/WorkflowTriggersCard";
import { WorkflowStepRailCard } from "../editor/WorkflowStepRailCard";
import { WorkflowStepPanel, type EditorAgent } from "../editor/WorkflowStepPanel";

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

const STEP_KINDS: WorkflowStepKind[] = ["agent.prompt", "shell.run", "scm.open_pr", "notify", "human.approval"];

function stepOutputNames(step: WorkflowStep): string[] {
  switch (step.kind) {
    case "shell.run":
      return step.outputName ? [step.outputName] : [];
    case "scm.open_pr":
      return ["pr_url", "pr_number"];
    case "agent.prompt":
      return ["output"];
    default:
      return [];
  }
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
  const { updateMutation } = useWorkflowMutations();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  // Seed the draft once the detail loads.
  useEffect(() => {
    if (draft === null && detailQuery.data) {
      const raw = detailQuery.data.currentVersion?.definition;
      setDraft({
        name: detailQuery.data.workflow.name,
        description: detailQuery.data.workflow.description ?? "",
        definition: parseWorkflowDefinition(raw ?? null),
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

  const issues = useMemo(
    () =>
      draft
        ? validateWorkflowDefinition(draft.definition, { harnessSupportsGoals: harnessSupportsGoals })
        : [],
    [draft],
  );

  const suggestions = useMemo(() => {
    if (draft === null || selectedStep === null) {
      return [];
    }
    const definition = draft.definition;
    return templateSuggestions({
      args: definition.args.map((arg) => ({ name: arg.name, type: arg.type })),
      stepIndex: selectedStep,
      priorStepOutputs: definition.steps.slice(0, selectedStep).map((step, index) => ({
        index,
        stepLabel: WORKFLOW_STEP_META[step.kind].label,
        outputNames: stepOutputNames(step),
      })),
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
  const markDirty = () => setSaved(false);

  const patchDefinition = (next: Partial<WorkflowDefinition>) => {
    markDirty();
    setDraft((prev) => (prev ? { ...prev, definition: { ...prev.definition, ...next } } : prev));
  };

  const setSetup = (setup: WorkflowSetup) => patchDefinition({ setup });
  const setArgs = (args: WorkflowArgSpec[]) => patchDefinition({ args });

  const updateStep = (index: number, step: WorkflowStep) =>
    patchDefinition({ steps: definition.steps.map((s, i) => (i === index ? step : s)) });

  const addStep = (kind: WorkflowStepKind) => {
    markDirty();
    const steps = [...definition.steps, createWorkflowStep(kind)];
    patchDefinition({ steps });
    setSelectedStep(steps.length - 1);
    setAddOpen(false);
  };

  const duplicateStep = (index: number) => {
    markDirty();
    const clone = JSON.parse(JSON.stringify(definition.steps[index])) as WorkflowStep;
    patchDefinition({ steps: [...definition.steps.slice(0, index + 1), clone, ...definition.steps.slice(index + 1)] });
  };

  const deleteStep = (index: number) => {
    markDirty();
    patchDefinition({ steps: definition.steps.filter((_, i) => i !== index) });
    setSelectedStep(null);
  };

  const reorder = (from: number, to: number) => {
    if (from === to) {
      return;
    }
    markDirty();
    patchDefinition({ steps: moveItem(definition.steps, from, to) });
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
      { onSuccess: () => setSaved(true) },
    );
  };

  const nameInvalid = draft.name.trim() === "";
  const canSave = !nameInvalid && issues.length === 0 && !updateMutation.isPending;

  return (
    <MainSidebarPageShell>
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-border px-6 py-3 pt-10">
          <button
            type="button"
            onClick={() => navigate("/workflows")}
            className="inline-flex items-center gap-1.5 text-ui-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Workflows
          </button>
          <div className="flex items-center gap-3">
            {issues.length > 0 ? (
              <span className="text-xs text-destructive">
                {issues.length} {issues.length === 1 ? "issue" : "issues"}
              </span>
            ) : saved ? (
              <span className="text-xs text-success">Saved</span>
            ) : null}
            <Button size="sm" onClick={handleSave} loading={updateMutation.isPending} disabled={!canSave}>
              Save
            </Button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <div
            className="min-w-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_1px_1px,var(--color-border)_1px,transparent_0)] [background-size:16px_16px]"
          >
            <div className="mx-auto flex max-w-2xl flex-col gap-3 px-6 py-6">
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
              <WorkflowSetupCard setup={definition.setup} args={definition.args} agents={agents} onSetupChange={setSetup} onArgsChange={setArgs} />
              <WorkflowTriggersCard />

              <div className="flex flex-col">
                {definition.steps.map((step, index) => (
                  <div
                    key={index}
                    draggable
                    onDragStart={() => setDragIndex(index)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      if (dragIndex !== null) {
                        reorder(dragIndex, index);
                      }
                      setDragIndex(null);
                    }}
                    className="pb-3"
                  >
                    <WorkflowStepRailCard
                      step={step}
                      index={index}
                      selected={selectedStep === index}
                      invalid={stepIssues(issues, index).length > 0}
                      canMoveUp={index > 0}
                      canMoveDown={index < definition.steps.length - 1}
                      onSelect={() => setSelectedStep(index)}
                      onChange={(next) => updateStep(index, next)}
                      onDuplicate={() => duplicateStep(index)}
                      onDelete={() => deleteStep(index)}
                      onMoveUp={() => reorder(index, index - 1)}
                      onMoveDown={() => reorder(index, index + 1)}
                    />
                    {index < definition.steps.length - 1 ? (
                      <div className="ml-6 h-3 w-px bg-border" aria-hidden />
                    ) : null}
                  </div>
                ))}

                <div className="relative">
                  <Button variant="secondary" size="sm" onClick={() => setAddOpen((v) => !v)}>
                    <Plus className="size-3.5" />
                    Add step
                  </Button>
                  {addOpen ? (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setAddOpen(false)} aria-hidden />
                      <div className="absolute left-0 z-20 mt-1 w-44 rounded-md border border-border bg-background p-1 shadow-md">
                        {STEP_KINDS.map((kind) => (
                          <button
                            key={kind}
                            type="button"
                            onClick={() => addStep(kind)}
                            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-ui-sm hover:bg-foreground/[0.05]"
                          >
                            <span aria-hidden className="w-4 text-center font-mono text-muted-foreground">
                              {WORKFLOW_STEP_META[kind].glyph}
                            </span>
                            {WORKFLOW_STEP_META[kind].label}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          {selectedStep !== null && definition.steps[selectedStep] ? (
            <div className="w-[380px] shrink-0 overflow-hidden border-l border-border bg-background">
              <WorkflowStepPanel
                step={definition.steps[selectedStep]!}
                setupHarness={definition.setup.harness}
                agents={agents}
                suggestions={suggestions}
                slackConnected={false}
                supportsGoals={harnessSupportsGoals}
                onChange={(next) => updateStep(selectedStep, next)}
                onClose={() => setSelectedStep(null)}
              />
            </div>
          ) : null}
        </div>
      </div>
    </MainSidebarPageShell>
  );
}
