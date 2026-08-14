import type { WorkflowInputV2 } from "@proliferate/cloud-sdk";
import { WORKFLOW_BUILDER_COPY } from "#product/copy/workflows/workflow-builder-copy";
import { Button } from "#product/primitives/Button";
import { Checkbox } from "#product/primitives/checkbox-primitive";
import { Plus, Trash } from "#product/primitives/icons/core";
import { Input } from "#product/primitives/Input";
import { Label } from "#product/primitives/Label";
import { Card } from "#product/primitives/patterns/Card";
import { NoticeBanner } from "#product/primitives/patterns/NoticeBanner";

export interface WorkflowBuilderInputsPanelProps {
  inputs: readonly WorkflowInputV2[];
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
 */
export function WorkflowBuilderInputsPanel({
  inputs,
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
          {inputs.map((input, index) => {
            const fieldPrefix = `workflow-builder-input-${index}`;
            const requiredId = `${fieldPrefix}-required`;
            return (
              <Card
                key={index}
                surface="tint"
                // Name, description, required and remove want distinct lanes
                // the spacing scale does not name: 1fr for the free-text
                // description, a fixed lane for the name, auto for the two
                // controls.
                className="grid items-end gap-3 p-3 sm:grid-cols-[12rem_minmax(0,1fr)_auto_auto]"
              >
                <div className="min-w-0">
                  <Label htmlFor={`${fieldPrefix}-name`}>
                    {WORKFLOW_BUILDER_COPY.inputNameLabel}
                  </Label>
                  <Input
                    id={`${fieldPrefix}-name`}
                    value={input.name}
                    disabled={disabled}
                    placeholder={WORKFLOW_BUILDER_COPY.inputNamePlaceholder}
                    onChange={(event) => onChange(index, { name: event.currentTarget.value })}
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
                    onChange={(event) =>
                      onChange(index, { description: event.currentTarget.value })}
                  />
                </div>
                <div className="flex h-9 items-center gap-2">
                  <Checkbox
                    id={requiredId}
                    checked={input.required}
                    disabled={disabled}
                    onCheckedChange={(checked) => onChange(index, { required: checked === true })}
                  />
                  <Label htmlFor={requiredId} className="mb-0 text-body text-foreground">
                    {WORKFLOW_BUILDER_COPY.inputRequiredLabel}
                  </Label>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={WORKFLOW_BUILDER_COPY.removeInputLabel(
                    input.name || String(index + 1),
                  )}
                  disabled={disabled}
                  onClick={() => onRemove(index)}
                >
                  <Trash className="icon-paired" aria-hidden />
                </Button>
              </Card>
            );
          })}
        </div>
      )}
    </Card>
  );
}
