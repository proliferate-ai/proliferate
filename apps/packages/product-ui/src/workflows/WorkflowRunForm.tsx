import type { WorkflowDefinitionInput } from "@proliferate/product-domain/workflows/definition";
import type {
  WorkflowArgumentDraft,
  WorkflowArgumentIssue,
} from "@proliferate/product-domain/workflows/arguments";
import { Button } from "@proliferate/ui/primitives/Button";
import { Checkbox } from "@proliferate/ui/primitives/Checkbox";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import { Select } from "@proliferate/ui/primitives/Select";

export interface WorkflowRunFormProps {
  inputs: readonly WorkflowDefinitionInput[];
  draft: WorkflowArgumentDraft;
  issues: readonly WorkflowArgumentIssue[];
  blockers: readonly WorkflowRunEligibilityBlockerView[];
  requiredForRunInputNames?: ReadonlySet<string>;
  capabilityEnabled: boolean;
  launchBlocked?: boolean;
  submitting?: boolean;
  serverError?: string | null;
  attemptMessage?: string | null;
  onChange: (draft: WorkflowArgumentDraft) => void;
  onSubmit: () => void;
  onRetryAttempt?: () => void;
}

export interface WorkflowRunEligibilityBlockerView {
  code: string;
  path: string;
  message: string;
}

export function WorkflowRunForm({
  inputs,
  draft,
  issues,
  blockers,
  requiredForRunInputNames = new Set<string>(),
  capabilityEnabled,
  launchBlocked = false,
  submitting = false,
  serverError = null,
  attemptMessage = null,
  onChange,
  onSubmit,
  onRetryAttempt,
}: WorkflowRunFormProps) {
  const ineligible = blockers.length > 0;
  const disabled = submitting || launchBlocked || ineligible || !capabilityEnabled;

  return (
    <section className="rounded-lg border border-border bg-card p-4" data-telemetry-block>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-foreground">Run in Cloud</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Starts one managed session using this saved workflow revision.
          </p>
        </div>
        <Button type="button" disabled={disabled} loading={submitting} onClick={onSubmit}>
          Run in Cloud
        </Button>
      </div>

      {!capabilityEnabled ? (
        <p className="mt-3 rounded-md border border-border bg-surface-raised px-3 py-2 text-xs text-muted-foreground" role="status">
          Managed Workflow runs are not enabled on this server. Saved workflows and existing run history remain available.
        </p>
      ) : null}
      {blockers.length > 0 ? (
        <div className="mt-3 rounded-md border border-warning/30 bg-warning/5 px-3 py-2" role="status">
          <p className="text-xs font-medium text-warning">This workflow cannot run yet.</p>
          <ul className="mt-1 space-y-1 text-xs text-warning">
            {[...blockers]
              .sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code))
              .map((blocker) => (
                <li key={`${blocker.path}:${blocker.code}`}>
                  <span className="font-mono">{blocker.path}</span>: {blocker.message}
                </li>
              ))}
          </ul>
        </div>
      ) : null}

      {inputs.length === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">This workflow has no inputs.</p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {inputs.map((input) => {
            const value = draft[input.name] ?? {
              supplied: false,
              value: input.type === "boolean" ? false : "",
            };
            const issue = issues.find((candidate) => candidate.path === `arguments.${input.name}`);
            const controlId = `workflow-run-input-${input.name}`;
            const includeControlId = `${controlId}-included`;
            const requiredByPrompt = !input.required && requiredForRunInputNames.has(input.name);
            const canOmit = !input.required && !requiredByPrompt;
            return (
              <div key={input.name} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor={controlId}>{input.name}</Label>
                  {canOmit ? (
                    <Label htmlFor={includeControlId} className="mb-0 flex items-center gap-2">
                      <Checkbox
                        id={includeControlId}
                        checked={value.supplied}
                        disabled={submitting}
                        onCheckedChange={(checked) => onChange({
                          ...draft,
                          [input.name]: { ...value, supplied: checked === true },
                        })}
                      />
                      Include
                    </Label>
                  ) : input.required ? (
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Required</span>
                  ) : (
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Required for run</span>
                  )}
                </div>
                {requiredByPrompt ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    This optional input is used by the prompt and must be supplied for this run.
                  </p>
                ) : null}
                <div className="mt-2" data-telemetry-mask>
                  {input.type === "boolean" ? (
                    <Select
                      id={controlId}
                      value={value.supplied ? String(value.value) : ""}
                      disabled={submitting || (canOmit && !value.supplied)}
                      aria-invalid={issue ? "true" : undefined}
                      onChange={(event) => onChange({
                        ...draft,
                        [input.name]: {
                          supplied: event.currentTarget.value !== "",
                          value: event.currentTarget.value === "true",
                        },
                      })}
                    >
                      <option value="">Choose true or false</option>
                      <option value="true">True</option>
                      <option value="false">False</option>
                    </Select>
                  ) : (
                    <Input
                      id={controlId}
                      type={input.type === "number" ? "number" : "text"}
                      value={String(value.value)}
                      disabled={submitting || (canOmit && !value.supplied)}
                      aria-invalid={issue ? "true" : undefined}
                      onChange={(event) => onChange({
                        ...draft,
                        [input.name]: {
                          supplied: true,
                          value: event.currentTarget.value,
                        },
                      })}
                    />
                  )}
                </div>
                {issue ? <p className="mt-1 text-xs text-destructive" role="alert">{issue.message}</p> : null}
              </div>
            );
          })}
        </div>
      )}

      {serverError ? <p className="mt-3 text-xs text-destructive" role="alert">{serverError}</p> : null}
      {attemptMessage ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <span>{attemptMessage}</span>
          {onRetryAttempt ? (
            <Button type="button" variant="secondary" size="sm" disabled={submitting} onClick={onRetryAttempt}>
              Check or retry this run
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
