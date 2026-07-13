import { Plus, Trash2 } from "lucide-react";
import type {
  WorkflowDefinitionInput,
  WorkflowInputType,
  WorkflowValidationIssue,
} from "@proliferate/product-domain/workflows/definition";
import { Checkbox } from "@proliferate/ui/kit/Checkbox";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import { Select } from "@proliferate/ui/primitives/Select";

export function WorkflowInputEditor({
  inputs,
  issues,
  disabled,
  onChange,
}: {
  inputs: readonly WorkflowDefinitionInput[];
  issues: readonly WorkflowValidationIssue[];
  disabled: boolean;
  onChange: (inputs: WorkflowDefinitionInput[]) => void;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium text-foreground">Inputs</h2>
          <p className="mt-0.5 text-xs leading-4 text-muted-foreground">
            Scalar values referenced as {"{{inputs.name}}"} in prompts and goals.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={() => onChange([
            ...inputs,
            { name: "", type: "string", required: true },
          ])}
        >
          <Plus className="size-3.5" aria-hidden />
          Add input
        </Button>
      </div>

      {inputs.length === 0 ? (
        <p className="mt-4 rounded-md bg-foreground/5 px-3 py-2 text-xs text-muted-foreground">
          This workflow has no inputs.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {inputs.map((input, index) => {
            const nameIssue = issues.find((issue) => issue.path === `inputs.${index}.name`);
            const requiredId = `workflow-input-${index}-required`;
            return (
              <div
                key={index}
                className="grid items-end gap-3 rounded-lg bg-foreground/5 p-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto_auto]"
              >
                <div className="min-w-0">
                  <Label htmlFor={`workflow-input-${index}-name`}>Name</Label>
                  <Input
                    id={`workflow-input-${index}-name`}
                    aria-invalid={nameIssue ? "true" : undefined}
                    value={input.name}
                    disabled={disabled}
                    placeholder="ticket"
                    onChange={(event) => updateInput(inputs, index, {
                      ...input,
                      name: event.currentTarget.value,
                    }, onChange)}
                  />
                  {nameIssue ? (
                    <p className="mt-1 text-xs text-destructive" role="alert">
                      {nameIssue.message}
                    </p>
                  ) : null}
                </div>
                <div>
                  <Label htmlFor={`workflow-input-${index}-type`}>Type</Label>
                  <Select
                    id={`workflow-input-${index}-type`}
                    value={input.type}
                    disabled={disabled}
                    onChange={(event) => updateInput(inputs, index, {
                      ...input,
                      type: event.currentTarget.value as WorkflowInputType,
                    }, onChange)}
                  >
                    <option value="string">String</option>
                    <option value="number">Number</option>
                    <option value="boolean">Boolean</option>
                  </Select>
                </div>
                <div className="flex h-9 items-center gap-2">
                  <Checkbox
                    id={requiredId}
                    checked={input.required}
                    disabled={disabled}
                    onCheckedChange={(checked) => updateInput(inputs, index, {
                      ...input,
                      required: checked === true,
                    }, onChange)}
                  />
                  <Label htmlFor={requiredId} className="mb-0 text-sm text-foreground">
                    Required
                  </Label>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove input ${input.name || index + 1}`}
                  disabled={disabled}
                  onClick={() => onChange(inputs.filter((_, candidateIndex) => candidateIndex !== index))}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function updateInput(
  inputs: readonly WorkflowDefinitionInput[],
  index: number,
  input: WorkflowDefinitionInput,
  onChange: (inputs: WorkflowDefinitionInput[]) => void,
): void {
  onChange(inputs.map((candidate, candidateIndex) => candidateIndex === index ? input : candidate));
}
