import type { WorkflowInputV2 } from "@proliferate/cloud-sdk";
import { WORKFLOW_BUILDER_COPY } from "#product/copy/workflows/workflow-builder-copy";
import type { WorkflowBuilderIssue } from "#product/lib/domain/workflows/workflow-builder-validation";
import { Button } from "#product/primitives/Button";
import { Checkbox } from "#product/primitives/checkbox-primitive";
import { Plus, Trash } from "#product/primitives/icons/core";
import { Input } from "#product/primitives/Input";
import { Label } from "#product/primitives/Label";
import { Card } from "#product/primitives/patterns/Card";
import { NoticeBanner } from "#product/primitives/patterns/NoticeBanner";

export interface WorkflowBuilderInputsPanelProps {
  inputs: readonly WorkflowInputV2[];
  /** Every issue; rows select their own by index. */
  issues: readonly WorkflowBuilderIssue[];
  disabled: boolean;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onChange: (index: number, patch: Partial<WorkflowInputV2>) => void;
}

/**
 * The run values a workflow declares. Names are what prompts spell as
 * `@input:name`, so an unreferenced input is legal and a referenced-but-absent
 * name is the validator's `unknown_input_ref` — reported on the step that
 * spells it, not here.
 *
 * What IS reported here is the name itself: the grammar the wire enforces and
 * uniqueness, both against the field the author has to change.
 */
export function WorkflowBuilderInputsPanel({
  inputs,
  issues,
  disabled,
  onAdd,
  onRemove,
  onChange,
}: WorkflowBuilderInputsPanelProps) {
  return (
    <Card as="section" surface="opaque" className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-heading font-medium text-foreground">
            {WORKFLOW_BUILDER_COPY.inputsHeading}
          </h2>
          <p className="mt-0.5 text-ui-sm leading-4 text-muted-foreground">
            {WORKFLOW_BUILDER_COPY.inputsDescription}
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={onAdd}>
          <Plus className="icon-paired" aria-hidden />
          {WORKFLOW_BUILDER_COPY.addInputLabel}
        </Button>
      </div>

      {inputs.length === 0 ? (
        <NoticeBanner tone="neutral" className="mt-4">
          {WORKFLOW_BUILDER_COPY.inputsEmpty}
        </NoticeBanner>
      ) : (
        <div className="mt-4 space-y-3">
          {inputs.map((input, index) => (
            <WorkflowBuilderInputRow
              key={index}
              input={input}
              index={index}
              issues={issuesForInput(issues, index)}
              disabled={disabled}
              onRemove={() => onRemove(index)}
              onChange={(patch) => onChange(index, patch)}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function WorkflowBuilderInputRow({
  input,
  index,
  issues,
  disabled,
  onRemove,
  onChange,
}: {
  input: WorkflowInputV2;
  index: number;
  issues: readonly WorkflowBuilderIssue[];
  disabled: boolean;
  onRemove: () => void;
  onChange: (patch: Partial<WorkflowInputV2>) => void;
}) {
  const fieldPrefix = `workflow-builder-input-${index}`;
  const requiredId = `${fieldPrefix}-required`;

  return (
    <Card surface="tint" className="p-3">
      {/* Name, description, required and remove want distinct lanes the
          spacing scale does not name: 1fr for the free-text description, a
          fixed lane for the name, auto for the two controls. */}
      <div className="grid items-end gap-3 sm:grid-cols-[12rem_minmax(0,1fr)_auto_auto]">
        <div className="min-w-0">
          <Label htmlFor={`${fieldPrefix}-name`}>
            {WORKFLOW_BUILDER_COPY.inputNameLabel}
          </Label>
          <Input
            id={`${fieldPrefix}-name`}
            value={input.name}
            disabled={disabled}
            aria-invalid={issues.length > 0 ? "true" : undefined}
            placeholder={WORKFLOW_BUILDER_COPY.inputNamePlaceholder}
            // Typed names are never rewritten: an author who wrote `my input`
            // is told the rule, because guessing at `my_input` would silently
            // rename what every prompt spells.
            onChange={(event) => onChange({ name: event.currentTarget.value })}
          />
        </div>
        <div className="min-w-0">
          <Label htmlFor={`${fieldPrefix}-description`}>
            {WORKFLOW_BUILDER_COPY.inputDescriptionLabel}
          </Label>
          <Input
            id={`${fieldPrefix}-description`}
            value={input.description}
            disabled={disabled}
            placeholder={WORKFLOW_BUILDER_COPY.inputDescriptionPlaceholder}
            onChange={(event) => onChange({ description: event.currentTarget.value })}
          />
        </div>
        <div className="flex h-9 items-center gap-2">
          <Checkbox
            id={requiredId}
            checked={input.required}
            disabled={disabled}
            onCheckedChange={(checked) => onChange({ required: checked === true })}
          />
          <Label htmlFor={requiredId} className="mb-0 text-body text-foreground">
            {WORKFLOW_BUILDER_COPY.inputRequiredLabel}
          </Label>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={WORKFLOW_BUILDER_COPY.removeInputLabel(input.name || String(index + 1))}
          disabled={disabled}
          onClick={onRemove}
        >
          <Trash className="icon-paired" aria-hidden />
        </Button>
      </div>

      {issues.length > 0 ? (
        <div className="mt-2 space-y-1" role="alert">
          {issues.map((issue, issueIndex) => (
            <p key={`${issue.code}:${issueIndex}`} className="text-ui text-destructive">
              {issue.message}
            </p>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

/**
 * Issues that belong on this row. Both name codes carry the row's position in
 * `index` — `duplicate_input_name` is attributed to the repeated declaration,
 * not the first one — so a rename shows the error against the entry that has to
 * change.
 */
function issuesForInput(
  issues: readonly WorkflowBuilderIssue[],
  index: number,
): WorkflowBuilderIssue[] {
  return issues.filter((issue) =>
    (issue.code === "invalid_input_name" || issue.code === "duplicate_input_name")
    && issue.index === index);
}
