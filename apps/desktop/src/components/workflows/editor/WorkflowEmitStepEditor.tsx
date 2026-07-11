import type { AgentEmitStep, WorkflowStep } from "@proliferate/product-domain/workflows/definition";
import type { TemplateSuggestion } from "@proliferate/product-domain/workflows/interpolation";
import { Input } from "@proliferate/ui/primitives/Input";
import { TemplateVarTextarea } from "./TemplateVarTextarea";
import { FieldLabel, InlineRow } from "./WorkflowStepFields";
import { WorkflowEmitSchemaBuilder } from "./WorkflowEmitSchemaBuilder";

export interface WorkflowEmitStepEditorProps {
  step: AgentEmitStep;
  suggestions: readonly TemplateSuggestion[];
  onChange: (step: WorkflowStep) => void;
}

/**
 * Write-output editor (`agent.emit`, feature spec §6.2): a prompt, the output
 * handle later steps address via `{{name.field}}`, the authored output JSON
 * Schema (WS9b item 1), and the retry budget.
 *
 * Note (WS9b): a required-invocation gate is NOT offered here because WS9a's
 * `AgentEmitStep` model (and the wire serializer) only carry `requiredInvocation`
 * on `AgentPromptStep`. The spec §7.1 allows an emit step to require an
 * invocation too; authoring that needs a product-domain change (flagged for the
 * captain). Every T3-WF fixture puts the gate on the prompt step, so prompt-only
 * authoring covers the launch matrix.
 */
export function WorkflowEmitStepEditor({ step, suggestions, onChange }: WorkflowEmitStepEditorProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Prompt</FieldLabel>
        <TemplateVarTextarea
          value={step.prompt}
          onChange={(prompt) => onChange({ ...step, prompt })}
          suggestions={suggestions}
          rows={5}
          ariaLabel="Prompt"
          placeholder="Decide the verdict and write it out."
          invalid={step.prompt.trim() === ""}
        />
      </div>
      <InlineRow label="Output name">
        <Input
          className="w-40 font-mono"
          value={step.name}
          placeholder="verdict"
          onChange={(event) => onChange({ ...step, name: event.target.value })}
        />
      </InlineRow>
      <WorkflowEmitSchemaBuilder
        schema={step.outputSchema}
        onChange={(outputSchema) => onChange({ ...step, outputSchema })}
      />
      <InlineRow label="Retry budget">
        <Input
          type="number"
          min={1}
          className="w-32"
          value={step.maxAttempts ?? ""}
          placeholder="3"
          onChange={(event) =>
            onChange({
              ...step,
              maxAttempts: event.target.value === "" ? undefined : Number(event.target.value),
            })
          }
        />
      </InlineRow>
      <p className="text-xs text-faint">
        Later steps reference this output as{" "}
        <span className="font-mono text-muted-foreground">{`{{${step.name || "name"}.field}}`}</span>.
      </p>
    </div>
  );
}
