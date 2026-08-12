import type { WorkflowDefinitionInput } from "#product/domain/workflows/definition";
import type {
  WorkflowArgumentDraft,
  WorkflowArgumentIssue,
} from "#product/domain/workflows/arguments";
import type { WorkflowRunEligibilityBlockerView } from "#product/lib/domain/workflows/workflow-run-eligibility";
import { Button } from "#product/primitives/Button";
import { Checkbox } from "#product/primitives/Checkbox";
import { Input } from "#product/primitives/Input";
import { Label } from "#product/primitives/Label";
import { Card } from "#product/primitives/patterns/Card";
import { NoticeBanner } from "#product/primitives/patterns/NoticeBanner";
import { Select } from "#product/primitives/Select";

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
    <Card as="section" surface="opaque" className="p-4" data-telemetry-block>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-heading font-medium text-foreground">Run in Cloud</h2>
          <p className="mt-1 text-ui-sm text-muted-foreground">
            Starts one managed session using this saved workflow revision.
          </p>
        </div>
        <Button type="button" disabled={disabled} loading={submitting} onClick={onSubmit}>
          Run in Cloud
        </Button>
      </div>

      {!capabilityEnabled ? (
        <NoticeBanner tone="neutral" className="mt-3">
          Managed Workflow runs are not enabled on this server. Saved workflows and existing run history remain available.
        </NoticeBanner>
      ) : null}
      {blockers.length > 0 ? (
        <NoticeBanner tone="warning" className="mt-3" title="This workflow cannot run yet.">
          <ul className="space-y-1">
            {[...blockers]
              .sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code))
              .map((blocker) => (
                <li key={`${blocker.path}:${blocker.code}`}>
                  <span className="font-mono">{blocker.path}</span>: {blocker.message}
                </li>
              ))}
          </ul>
        </NoticeBanner>
      ) : null}

      {inputs.length === 0 ? (
        <p className="mt-4 text-ui-sm text-muted-foreground">This workflow has no inputs.</p>
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
              <Card key={input.name} surface="opaque" className="p-3">
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
                    <span className="text-ui-sm uppercase tracking-wide text-muted-foreground">Required</span>
                  ) : (
                    <span className="text-ui-sm uppercase tracking-wide text-muted-foreground">Required for run</span>
                  )}
                </div>
                {requiredByPrompt ? (
                  <p className="mt-1 text-ui-sm text-muted-foreground">
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
                {issue ? <p className="mt-1 text-ui text-destructive" role="alert">{issue.message}</p> : null}
              </Card>
            );
          })}
        </div>
      )}

      {serverError ? <p className="mt-3 text-ui text-destructive" role="alert">{serverError}</p> : null}
      {attemptMessage ? (
        <div className="mt-3 flex items-center gap-2 text-ui-sm text-muted-foreground" role="status">
          <span>{attemptMessage}</span>
          {onRetryAttempt ? (
            <Button type="button" variant="secondary" size="sm" disabled={submitting} onClick={onRetryAttempt}>
              Check or retry this run
            </Button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
