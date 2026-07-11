import { useMemo } from "react";
import {
  parseWorkflowDefinition,
  type WorkflowIncludeStep,
  type WorkflowStep,
} from "@proliferate/product-domain/workflows/definition";
import type { TemplateSuggestion } from "@proliferate/product-domain/workflows/interpolation";
import { useWorkflowDetail } from "@/hooks/access/cloud/workflows/use-workflows";
import { TemplateVarTextarea } from "./TemplateVarTextarea";
import { FieldLabel, InlineRow } from "./WorkflowStepFields";
import { WorkflowSelect } from "./WorkflowSelect";

export interface EditorIncludableWorkflow {
  id: string;
  name: string;
}

export interface WorkflowIncludeStepEditorProps {
  step: WorkflowIncludeStep;
  suggestions: readonly TemplateSuggestion[];
  includableWorkflows: readonly EditorIncludableWorkflow[];
  onChange: (step: WorkflowStep) => void;
}

/**
 * Composition editor (spec 3.5 / L20, WS9b item 5): pick a workflow to inline,
 * then map its declared inputs to templated values written in THIS workflow's
 * context (arg name → template string, matching the server composition
 * validation). The target's steps run inline in this workflow's single run —
 * there is no child run (the server splices them at StartRun, before delivery).
 * The child's declared inputs are read from the existing workflow-detail hook
 * once a target is picked.
 */
export function WorkflowIncludeStepEditor({
  step,
  suggestions,
  includableWorkflows,
  onChange,
}: WorkflowIncludeStepEditorProps) {
  const detailQuery = useWorkflowDetail(step.workflowId || null);
  const childInputs = useMemo(() => {
    const raw = detailQuery.data?.currentVersion?.definition;
    return raw ? parseWorkflowDefinition(raw).inputs : [];
  }, [detailQuery.data]);

  const pickTarget = (workflowId: string) => {
    // A new target has its own input schema; drop stale mappings on switch.
    onChange({ ...step, workflowId, args: {} });
  };
  const setArg = (name: string, value: string) => {
    onChange({ ...step, args: { ...step.args, [name]: value } });
  };

  return (
    <div className="flex flex-col gap-4">
      <InlineRow label="Workflow">
        <WorkflowSelect
          ariaLabel="Workflow to include"
          value={step.workflowId || ""}
          placeholder={includableWorkflows.length > 0 ? "Select a workflow" : "No other workflows"}
          disabled={includableWorkflows.length === 0}
          options={includableWorkflows.map((wf) => ({ value: wf.id, label: wf.name }))}
          onChange={pickTarget}
        />
      </InlineRow>
      {step.workflowId ? (
        childInputs.length > 0 ? (
          <div className="flex flex-col gap-3">
            <FieldLabel>Inputs</FieldLabel>
            {childInputs.map((input) => (
              <div key={input.name} className="flex flex-col gap-1">
                <span className="font-mono text-xs text-muted-foreground">
                  {input.name}
                  {input.required ? <span className="text-destructive"> *</span> : null}
                </span>
                <TemplateVarTextarea
                  value={step.args[input.name] ?? ""}
                  onChange={(value) => setArg(input.name, value)}
                  suggestions={suggestions}
                  rows={2}
                  placeholder={`{{inputs.…}} or a value for ${input.name}`}
                />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-faint">This workflow takes no inputs.</p>
        )
      ) : null}
      <p className="text-xs text-faint">
        Steps run inline in this workflow&apos;s single run.
      </p>
    </div>
  );
}
