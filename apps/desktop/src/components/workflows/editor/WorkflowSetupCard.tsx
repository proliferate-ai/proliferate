import { useState } from "react";
import {
  type WorkflowInputSpec,
  type WorkflowInputType,
} from "@proliferate/product-domain/workflows/definition";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import { Switch } from "@proliferate/ui/primitives/Switch";
import { Button } from "@proliferate/ui/primitives/Button";
import { ChevronDown, ChevronRight, Plus, X } from "@proliferate/ui/icons";
import type { EditorAgent } from "./WorkflowStepPanel";
import { WorkflowSelect } from "./WorkflowSelect";

export interface WorkflowSetupCardProps {
  inputs: WorkflowInputSpec[];
  agents: readonly EditorAgent[];
  onInputsChange: (inputs: WorkflowInputSpec[]) => void;
}

const INPUT_TYPES: WorkflowInputType[] = ["text", "number", "choice", "boolean"];

/** Aligned columns shared by the input table header and every input row. */
function InputRow({
  input,
  onChange,
  onRemove,
}: {
  input: WorkflowInputSpec;
  onChange: (input: WorkflowInputSpec) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Input
          value={input.name}
          placeholder="name"
          aria-label="Input name"
          className="min-w-0 flex-1 font-mono"
          onChange={(event) => onChange({ ...input, name: event.target.value })}
        />
        <WorkflowSelect
          ariaLabel="Input type"
          value={input.type}
          className="w-24"
          menuWidthClassName="w-32"
          align="start"
          options={INPUT_TYPES.map((type) => ({ value: type, label: type }))}
          onChange={(value) => {
            const type = value as WorkflowInputType;
            const next: WorkflowInputSpec = { ...input, type };
            // A default typed for the old type (e.g. a choice value, or a
            // number string) is almost never valid for the new one — clear it
            // rather than carry a stale mismatched value forward.
            delete next.default;
            if (type === "choice" && !next.choices) {
              next.choices = [];
            }
            if (type !== "choice") {
              delete next.choices;
            }
            onChange(next);
          }}
        />
        {input.type === "boolean" ? (
          <div className="flex w-28 shrink-0 items-center">
            <Switch checked={input.default === true} onChange={(checked) => onChange({ ...input, default: checked })} />
          </div>
        ) : (
          <Input
            value={input.default === undefined ? "" : String(input.default)}
            placeholder="default"
            aria-label="Default value"
            className="w-28 shrink-0"
            onChange={(event) => {
              const raw = event.target.value;
              const value: WorkflowInputSpec = { ...input };
              if (raw === "") {
                delete value.default;
              } else {
                value.default = input.type === "number" && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
              }
              onChange(value);
            }}
          />
        )}
        <div className="flex w-14 shrink-0 justify-center">
          <Switch
            aria-label="Required"
            checked={input.required}
            onChange={(checked) => onChange({ ...input, required: checked })}
          />
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Remove input" className="shrink-0" onClick={onRemove}>
          <X className="size-4" />
        </Button>
      </div>
      {input.type === "choice" ? (
        <Input
          value={(input.choices ?? []).join(", ")}
          placeholder="value1, value2"
          aria-label="Choice values"
          className="font-mono"
          onChange={(event) =>
            onChange({
              ...input,
              choices: event.target.value
                .split(",")
                .map((value) => value.trim())
                .filter((value) => value.length > 0),
            })
          }
        />
      ) : null}
    </div>
  );
}

/**
 * The Configuration card: the workflow's declared inputs (data-contract §1).
 * Visually consistent with the rail card language (rounded-xl, border, shadow-sm).
 */
export function WorkflowSetupCard({ inputs, agents: _agents, onInputsChange }: WorkflowSetupCardProps) {
  const [expanded, setExpanded] = useState(false);

  const updateInput = (index: number, next: WorkflowInputSpec) => {
    onInputsChange(inputs.map((input, i) => (i === index ? next : input)));
  };

  const summary = inputs.length > 0 ? `${inputs.length} ${inputs.length === 1 ? "input" : "inputs"}` : null;

  return (
    <div className="rounded-xl border border-border bg-background shadow-sm">
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-xl px-4 py-3 text-left transition-colors hover:bg-list-hover"
      >
        <span className="flex min-w-0 flex-col">
          <span className="text-sm font-medium text-foreground">Configuration</span>
          {summary ? <span className="truncate text-xs text-muted-foreground">{summary}</span> : null}
        </span>
        {expanded ? <ChevronDown className="size-4 shrink-0 text-faint" /> : <ChevronRight className="size-4 shrink-0 text-faint" />}
      </Button>

      {expanded ? (
        <div className="flex flex-col gap-4 border-t border-border/60 px-4 py-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label className="mb-0">Inputs</Label>
              <span className="text-xs text-faint">Prompted on each run · use {"{{inputs.name}}"} in steps</span>
            </div>

            {inputs.length > 0 ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 px-0.5 text-xs text-faint">
                  <span className="min-w-0 flex-1">Name</span>
                  <span className="w-24">Type</span>
                  <span className="w-28">Default</span>
                  <span className="w-14 text-center">Req</span>
                  <span className="w-7 shrink-0" />
                </div>
                {inputs.map((input, index) => (
                  <InputRow
                    key={index}
                    input={input}
                    onChange={(next) => updateInput(index, next)}
                    onRemove={() => onInputsChange(inputs.filter((_, i) => i !== index))}
                  />
                ))}
              </div>
            ) : null}

            <Button
              type="button"
              variant="unstyled"
              size="unstyled"
              onClick={() => onInputsChange([...inputs, { name: "", type: "text", required: false }])}
              className="flex items-center gap-1.5 self-start rounded-md px-1.5 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <Plus className="size-3.5" />
              Add input
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
