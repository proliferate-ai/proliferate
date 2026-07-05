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
import { deriveEffectiveConfigs } from "@proliferate/product-domain/workflows/effective-config";
import { MainSidebarPageShell } from "@/components/workspace/shell/screen/MainSidebarPageShell";
import { Button } from "@proliferate/ui/primitives/Button";
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
import { useWorkflowDetail } from "@/hooks/access/cloud/workflows/use-workflows";
import { useWorkflowMutations } from "@/hooks/access/cloud/workflows/use-workflow-mutations";
import type { WorkflowRunTargetOption } from "@/components/workflows/home/WorkflowRunArgsModal";
import { harnessSupportsGoals } from "@/lib/domain/workflows/goal-capability";
import { WorkflowMetaCard } from "../editor/WorkflowMetaCard";
import { WorkflowSetupCard, WorkflowSetupAgentCard } from "../editor/WorkflowSetupCard";
import { WorkflowTriggersCard } from "../editor/WorkflowTriggersCard";
import { WorkflowStepRailCard } from "../editor/WorkflowStepRailCard";
import { WorkflowStepConnector } from "../editor/WorkflowStepConnector";
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

const STEP_KINDS: WorkflowStepKind[] = ["agent.prompt", "agent.config", "shell.run", "scm.open_pr", "notify", "human.approval"];

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

/** The active harness at a step index: Setup harness folded through earlier `agent.config`. */
function effectiveHarnessAt(definition: WorkflowDefinition, stepIndex: number): string {
  let harness = definition.setup.harness;
  for (let i = 0; i < stepIndex; i++) {
    const step = definition.steps[i];
    if (step && step.kind === "agent.config" && step.harness?.trim()) {
      harness = step.harness;
    }
  }
  return harness;
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
  const { updateMutation } = useWorkflowMutations();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const [setupSelected, setSetupSelected] = useState(false);
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

  const issues = useMemo(
    () =>
      draft
        ? validateWorkflowDefinition(draft.definition, { harnessSupportsGoals: harnessSupportsGoals })
        : [],
    [draft],
  );

  const effectiveConfigs = useMemo(
    () => (draft ? deriveEffectiveConfigs(draft.definition) : []),
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
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Workflows
          </button>
          <div className="flex items-center gap-2">
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
            ) : saved ? (
              <span className="text-xs font-medium text-success">Saved</span>
            ) : null}
            <Button size="sm" onClick={handleSave} loading={updateMutation.isPending} disabled={!canSave}>
              Save
            </Button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 overflow-hidden transition-[grid-template-columns] duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] grid-cols-[1fr]" style={(selectedStep !== null && definition.steps[selectedStep]) || setupSelected ? { gridTemplateColumns: "1fr minmax(0, min(50%, 420px))" } : undefined}>
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
              <WorkflowSetupAgentCard
                setup={definition.setup}
                agents={agents}
                selected={setupSelected}
                onSelect={() => { setSetupSelected(true); setSelectedStep(null); }}
              />
              <WorkflowSetupCard setup={definition.setup} args={definition.args} agents={agents} onSetupChange={setSetup} onArgsChange={setArgs} />
              <WorkflowTriggersCard
                workflowId={workflowId}
                args={definition.args}
                cloudWorkspaces={cloudWorkspaceOptions}
              />

              <div className="flex flex-col">
                {definition.steps.map((step, index) => {
                  const nextConfig = effectiveConfigs[index + 1];
                  const nextIsNewSession = nextConfig?.isNewSession === true;
                  const thisConfig = effectiveConfigs[index];
                  // Show scope label at the start of each scope group
                  const isFirstInScope = thisConfig && (
                    index === 0 || thisConfig.scopeIndex !== effectiveConfigs[index - 1]?.scopeIndex
                  );
                  const scopeLabel = isFirstInScope && thisConfig
                    ? `${thisConfig.effectiveHarness} · ${thisConfig.effectiveModel}`
                    : null;
                  return (
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
                    >
                      <WorkflowStepRailCard
                        step={step}
                        index={index}
                        selected={selectedStep === index}
                        invalid={stepIssues(issues, index).length > 0}
                        connector={!nextIsNewSession}
                        canMoveUp={index > 0}
                        canMoveDown={index < definition.steps.length - 1}
                        onSelect={() => { setSelectedStep(index); setSetupSelected(false); }}
                        onChange={(next) => updateStep(index, next)}
                        onDuplicate={() => duplicateStep(index)}
                        onDelete={() => deleteStep(index)}
                        onMoveUp={() => reorder(index, index - 1)}
                        onMoveDown={() => reorder(index, index + 1)}
                        scopeAnnotation={
                          step.kind === "agent.config" && effectiveConfigs[index]
                            ? effectiveConfigs[index]
                            : null
                        }
                        scopeLabel={scopeLabel}
                      />
                      {nextIsNewSession ? (
                        <WorkflowStepConnector
                          sessionBreak={{ label: `new session · ${nextConfig.effectiveHarness}` }}
                        />
                      ) : null}
                    </div>
                  );
                })}

                <div className="flex justify-start pl-[6px]">
                  <PopoverButton
                    align="start"
                    side="bottom"
                    externalOpen={addOpen}
                    onOpenChange={setAddOpen}
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
                            onClick={() => { close(); addStep(kind); }}
                          />
                        ))}
                      </div>
                    )}
                  </PopoverButton>
                </div>
              </div>
            </div>
          </div>

          {selectedStep !== null && definition.steps[selectedStep] ? (
            <div className="overflow-hidden border-l border-border bg-background">
              <WorkflowStepPanel
                step={definition.steps[selectedStep]!}
                effectiveHarness={effectiveHarnessAt(definition, selectedStep)}
                agents={agents}
                suggestions={suggestions}
                slackConnected={false}
                supportsGoals={harnessSupportsGoals}
                onChange={(next) => updateStep(selectedStep, next)}
                onClose={() => setSelectedStep(null)}
              />
            </div>
          ) : setupSelected ? (
            <div className="flex h-full flex-col overflow-hidden border-l border-border bg-background">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <span className="inline-flex select-none items-center gap-1.5 rounded-full border border-border bg-transparent px-3 py-0.5 text-xs font-medium leading-none text-foreground">
                  <Robot className="size-3.5 shrink-0 text-foreground" />
                  <span>Agent</span>
                </span>
                <Button variant="ghost" size="icon-sm" onClick={() => setSetupSelected(false)} aria-label="Close panel">
                  <X className="size-4" />
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <div className="flex flex-col gap-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="w-28 shrink-0 text-sm text-muted-foreground">Agent</span>
                    <div className="flex flex-1 justify-end">
                      <WorkflowSelect
                        ariaLabel="Agent"
                        value={definition.setup.harness || ""}
                        placeholder="Select agent"
                        options={agents.map((agent) => ({ value: agent.kind, label: agent.displayName }))}
                        onChange={(harness) => {
                          markDirty();
                          const next = agents.find((agent) => agent.kind === harness);
                          setSetup({ ...definition.setup, harness, model: next?.models[0]?.id ?? "" });
                        }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="w-28 shrink-0 text-sm text-muted-foreground">Model</span>
                    <div className="flex flex-1 justify-end">
                      <WorkflowSelect
                        ariaLabel="Model"
                        value={definition.setup.model || ""}
                        placeholder="Select model"
                        disabled={(agents.find((a) => a.kind === definition.setup.harness)?.models ?? []).length === 0}
                        options={(agents.find((a) => a.kind === definition.setup.harness)?.models ?? []).map((model) => ({ value: model.id, label: model.label }))}
                        onChange={(model) => {
                          markDirty();
                          setSetup({ ...definition.setup, model });
                        }}
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
