import { Plus, Trash2 } from "lucide-react";
import {
  workflowAgentOptions,
  workflowAgentSupportsGoals,
  workflowEffortOptions,
  workflowModelOptions,
  type WorkflowAgentCatalog,
  type WorkflowAgentPromptStep,
  type WorkflowDefinitionStage,
  type WorkflowValidationIssue,
} from "@proliferate/product-domain/workflows/definition";
import { Button } from "@proliferate/ui/primitives/Button";
import { Label } from "@proliferate/ui/primitives/Label";
import { Select } from "@proliferate/ui/primitives/Select";
import { Textarea } from "@proliferate/ui/primitives/Textarea";

export function WorkflowStageEditor({
  stage,
  stageIndex,
  stageCount,
  catalog,
  issues,
  disabled,
  onChange,
  onRemove,
}: {
  stage: WorkflowDefinitionStage;
  stageIndex: number;
  stageCount: number;
  catalog: WorkflowAgentCatalog | null;
  issues: readonly WorkflowValidationIssue[];
  disabled: boolean;
  onChange: (stage: WorkflowDefinitionStage) => void;
  onRemove: () => void;
}) {
  const stagePath = `stages.${stageIndex}`;
  const agentOptions = workflowAgentOptions(catalog);
  const modelOptions = workflowModelOptions(catalog, stage.harnessConfig.agentKind);
  const effortOptions = workflowEffortOptions(
    catalog,
    stage.harnessConfig.agentKind,
    stage.harnessConfig.modelId,
  );
  const supportsGoals = workflowAgentSupportsGoals(catalog, stage.harnessConfig.agentKind);
  const agentIssue = issueAt(issues, `${stagePath}.harnessConfig.agentKind`);
  const modelIssue = issueAt(issues, `${stagePath}.harnessConfig.modelId`);
  const effortIssue = issueAt(issues, `${stagePath}.harnessConfig.effort`);
  const selectedAgentUnavailable = Boolean(stage.harnessConfig.agentKind)
    && !agentOptions.some((option) => option.value === stage.harnessConfig.agentKind);
  const selectedModelUnavailable = Boolean(stage.harnessConfig.modelId)
    && !modelOptions.some((option) => option.value === stage.harnessConfig.modelId);
  const selectedEffortUnavailable = Boolean(stage.harnessConfig.effort)
    && !effortOptions.some((option) => option.value === stage.harnessConfig.effort);

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium text-foreground">Stage {stageIndex + 1}</h2>
          <p className="mt-0.5 text-xs leading-4 text-muted-foreground">
            One agent session. Prompt steps run sequentially in the same session.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Remove stage ${stageIndex + 1}`}
          disabled={disabled || stageCount === 1}
          onClick={onRemove}
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor={`workflow-stage-${stageIndex}-harness`}>Harness</Label>
          <Select
            id={`workflow-stage-${stageIndex}-harness`}
            aria-invalid={agentIssue ? "true" : undefined}
            value={stage.harnessConfig.agentKind}
            disabled={disabled || agentOptions.length === 0}
            onChange={(event) => onChange({
              ...stage,
              harnessConfig: {
                agentKind: event.currentTarget.value,
                modelId: null,
                effort: null,
              },
            })}
          >
            {agentOptions.length === 0 ? <option value="">Catalog unavailable</option> : null}
            {selectedAgentUnavailable ? (
              <option value={stage.harnessConfig.agentKind}>
                Unavailable harness ({stage.harnessConfig.agentKind})
              </option>
            ) : null}
            {agentOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
          <FieldIssue issue={agentIssue} />
        </div>
        <div>
          <Label htmlFor={`workflow-stage-${stageIndex}-model`}>Model</Label>
          <Select
            id={`workflow-stage-${stageIndex}-model`}
            aria-invalid={modelIssue ? "true" : undefined}
            value={stage.harnessConfig.modelId ?? ""}
            disabled={disabled || !stage.harnessConfig.agentKind}
            onChange={(event) => onChange({
              ...stage,
              harnessConfig: {
                ...stage.harnessConfig,
                modelId: event.currentTarget.value || null,
                effort: null,
              },
            })}
          >
            <option value="">Runtime default</option>
            {selectedModelUnavailable ? (
              <option value={stage.harnessConfig.modelId ?? ""}>
                Unavailable model ({stage.harnessConfig.modelId})
              </option>
            ) : null}
            {modelOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
          <FieldIssue issue={modelIssue} />
        </div>
        <div>
          <Label htmlFor={`workflow-stage-${stageIndex}-effort`}>Effort</Label>
          <Select
            id={`workflow-stage-${stageIndex}-effort`}
            aria-invalid={effortIssue ? "true" : undefined}
            value={stage.harnessConfig.effort ?? ""}
            disabled={
              disabled
              || !stage.harnessConfig.modelId
              || (effortOptions.length === 0 && !selectedEffortUnavailable)
            }
            onChange={(event) => onChange({
              ...stage,
              harnessConfig: {
                ...stage.harnessConfig,
                effort: event.currentTarget.value || null,
              },
            })}
          >
            <option value="">Runtime default</option>
            {selectedEffortUnavailable ? (
              <option value={stage.harnessConfig.effort ?? ""}>
                Unavailable effort ({stage.harnessConfig.effort})
              </option>
            ) : null}
            {effortOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
          <FieldIssue issue={effortIssue} />
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {stage.steps.map((step, stepIndex) => (
          <PromptStepEditor
            key={stepIndex}
            step={step}
            stageIndex={stageIndex}
            stepIndex={stepIndex}
            stepCount={stage.steps.length}
            supportsGoals={supportsGoals}
            issues={issues}
            disabled={disabled}
            onChange={(nextStep) => onChange({
              ...stage,
              steps: stage.steps.map((candidate, candidateIndex) =>
                candidateIndex === stepIndex ? nextStep : candidate
              ),
            })}
            onRemove={() => onChange({
              ...stage,
              steps: stage.steps.filter((_, candidateIndex) => candidateIndex !== stepIndex),
            })}
          />
        ))}
      </div>

      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="mt-3"
        disabled={disabled}
        onClick={() => onChange({
          ...stage,
          steps: [...stage.steps, createPromptStep()],
        })}
      >
        <Plus className="size-3.5" aria-hidden />
        Add prompt
      </Button>
    </section>
  );
}

function PromptStepEditor({
  step,
  stageIndex,
  stepIndex,
  stepCount,
  supportsGoals,
  issues,
  disabled,
  onChange,
  onRemove,
}: {
  step: WorkflowAgentPromptStep;
  stageIndex: number;
  stepIndex: number;
  stepCount: number;
  supportsGoals: boolean;
  issues: readonly WorkflowValidationIssue[];
  disabled: boolean;
  onChange: (step: WorkflowAgentPromptStep) => void;
  onRemove: () => void;
}) {
  const stepPath = `stages.${stageIndex}.steps.${stepIndex}`;
  const promptIssues = issuesAt(issues, `${stepPath}.prompt`);
  const goalIssues = issues.filter((issue) => issue.path.startsWith(`${stepPath}.goal`));

  return (
    <div className="rounded-lg bg-foreground/5 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-muted-foreground">Prompt {stepIndex + 1}</p>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove prompt ${stepIndex + 1}`}
          disabled={disabled || stepCount === 1}
          onClick={onRemove}
        >
          <Trash2 className="size-3.5" aria-hidden />
        </Button>
      </div>
      <Label htmlFor={`workflow-stage-${stageIndex}-step-${stepIndex}-prompt`}>
        Prompt
      </Label>
      <Textarea
        id={`workflow-stage-${stageIndex}-step-${stepIndex}-prompt`}
        value={step.prompt}
        rows={4}
        disabled={disabled}
        aria-invalid={promptIssues.length > 0 ? "true" : undefined}
        placeholder="Investigate {{inputs.ticket}} and report the root cause."
        onChange={(event) => onChange({ ...step, prompt: event.currentTarget.value })}
      />
      <IssueList issues={promptIssues} />

      {step.goal ? (
        <div className="mt-3">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={`workflow-stage-${stageIndex}-step-${stepIndex}-goal`}>
              Goal objective
            </Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => onChange({ ...step, goal: null })}
            >
              Remove goal
            </Button>
          </div>
          <Textarea
            id={`workflow-stage-${stageIndex}-step-${stepIndex}-goal`}
            value={step.goal.objective}
            rows={2}
            disabled={disabled}
            aria-invalid={goalIssues.length > 0 ? "true" : undefined}
            placeholder="Produce an evidence-backed diagnosis."
            onChange={(event) => onChange({
              ...step,
              goal: { objective: event.currentTarget.value },
            })}
          />
          <IssueList issues={goalIssues} />
        </div>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-2"
          disabled={disabled || !supportsGoals}
          title={supportsGoals ? undefined : "The selected harness does not support goals."}
          onClick={() => onChange({ ...step, goal: { objective: "" } })}
        >
          <Plus className="size-3.5" aria-hidden />
          Add goal
        </Button>
      )}
    </div>
  );
}

export function createPromptStep(): WorkflowAgentPromptStep {
  return { kind: "agent.prompt", prompt: "", goal: null };
}

function issueAt(
  issues: readonly WorkflowValidationIssue[],
  path: string,
): WorkflowValidationIssue | null {
  return issues.find((issue) => issue.path === path) ?? null;
}

function issuesAt(
  issues: readonly WorkflowValidationIssue[],
  path: string,
): WorkflowValidationIssue[] {
  return issues.filter((issue) => issue.path === path);
}

function FieldIssue({ issue }: { issue: WorkflowValidationIssue | null }) {
  return issue ? (
    <p className="mt-1 text-xs text-destructive" role="alert">{issue.message}</p>
  ) : null;
}

function IssueList({ issues }: { issues: readonly WorkflowValidationIssue[] }) {
  if (issues.length === 0) {
    return null;
  }
  return (
    <div className="mt-1 space-y-1" role="alert">
      {issues.map((issue, index) => (
        <p key={`${issue.path}:${issue.message}:${index}`} className="text-xs text-destructive">
          {issue.message}
        </p>
      ))}
    </div>
  );
}
