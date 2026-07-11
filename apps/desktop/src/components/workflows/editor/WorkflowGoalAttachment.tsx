import {
  defaultWorkflowGoal,
  type WorkflowGoal,
  type WorkflowGoalOnBlocked,
} from "@proliferate/product-domain/workflows/definition";
import type { TemplateSuggestion } from "@proliferate/product-domain/workflows/interpolation";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import { Switch } from "@proliferate/ui/primitives/Switch";
import { TemplateVarTextarea } from "./TemplateVarTextarea";
import { WorkflowSelect } from "./WorkflowSelect";

export interface WorkflowGoalAttachmentProps {
  goal: WorkflowGoal | undefined;
  supportsGoals: boolean;
  harnessLabel: string;
  suggestions: readonly TemplateSuggestion[];
  onChange: (goal: WorkflowGoal | undefined) => void;
}

const ON_BLOCKED_OPTIONS: { value: WorkflowGoalOnBlocked; label: string }[] = [
  { value: "notify", label: "Notify" },
  { value: "pause_for_approval", label: "Pause for approval" },
  { value: "fail", label: "Fail the run" },
];

/**
 * The goal-attachment section (spec 3.6): `◎ Iterate until` with caps and an
 * optional verify gate. Rendered only when the effective harness advertises
 * goal support — otherwise a quiet caption, exactly like the goal bar.
 */
export function WorkflowGoalAttachment({
  goal,
  supportsGoals,
  harnessLabel,
  suggestions,
  onChange,
}: WorkflowGoalAttachmentProps) {
  if (!supportsGoals) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-faint">
        Goal iteration: not supported by {harnessLabel}
      </p>
    );
  }

  const enabled = goal !== undefined;
  const patch = (next: Partial<WorkflowGoal>) => {
    if (goal) {
      onChange({ ...goal, ...next });
    }
  };

  return (
    <div className="rounded-[10px] border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <span aria-hidden className="font-mono text-info">
            ◎
          </span>
          Iterate until
        </span>
        <Switch
          checked={enabled}
          onChange={(checked) => onChange(checked ? defaultWorkflowGoal(goal?.objective ?? "") : undefined)}
        />
      </div>

      {enabled && goal ? (
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Objective</Label>
            <TemplateVarTextarea
              value={goal.objective}
              onChange={(value) => patch({ objective: value })}
              suggestions={suggestions}
              rows={2}
              ariaLabel="Goal objective"
              placeholder="the full test suite passes"
              invalid={goal.objective.trim() === ""}
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col gap-1">
              <Label>Max turns</Label>
              <Input
                type="number"
                min={1}
                value={goal.maxTurns}
                onChange={(event) => patch({ maxTurns: Number(event.target.value) })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label>Max minutes</Label>
              <Input
                type="number"
                min={1}
                value={Math.round(goal.maxWallSecs / 60)}
                onChange={(event) => patch({ maxWallSecs: Math.max(1, Number(event.target.value)) * 60 })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label>Max tokens</Label>
              <Input
                type="number"
                min={1}
                value={goal.tokenBudget ?? ""}
                onChange={(event) => {
                  const value = event.target.value;
                  patch({ tokenBudget: value === "" ? undefined : Number(value) });
                }}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>When blocked</Label>
            <WorkflowSelect
              ariaLabel="When blocked"
              value={goal.onBlocked}
              options={ON_BLOCKED_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
              onChange={(value) => patch({ onBlocked: value as WorkflowGoalOnBlocked })}
            />
          </div>

          <div className="rounded-md border border-border/70 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">
                Verify (runs when the agent claims the goal is met)
              </span>
              <Switch
                checked={goal.verify !== undefined}
                onChange={(checked) => patch({ verify: checked ? { shell: "", expectExit: 0 } : undefined })}
              />
            </div>
            {goal.verify ? (
              <div className="mt-2 flex items-center gap-2">
                <Input
                  className="flex-1 font-mono"
                  value={goal.verify.shell}
                  placeholder="make test"
                  onChange={(event) =>
                    patch({ verify: { shell: event.target.value, expectExit: goal.verify!.expectExit } })
                  }
                />
                <span className="text-xs text-faint">exit</span>
                <Input
                  type="number"
                  className="w-16"
                  value={goal.verify.expectExit}
                  onChange={(event) =>
                    patch({ verify: { shell: goal.verify!.shell, expectExit: Number(event.target.value) } })
                  }
                />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
