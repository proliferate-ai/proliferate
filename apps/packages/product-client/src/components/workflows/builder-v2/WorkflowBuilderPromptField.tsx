import { WORKFLOW_BUILDER_COPY } from "#product/copy/workflows/workflow-builder-copy";
import {
  INSPECTOR_EYEBROW_CLASS,
  INSPECTOR_EYEBROW_STYLE,
  INSPECTOR_TEXTAREA_STYLE,
} from "#product/components/workflows/builder-v2/WorkflowBuilderNodeInspector";

export interface WorkflowBuilderPromptFieldProps {
  fieldId: string;
  value: string;
  disabled: boolean;
  invalid: boolean;
  onChange: (prompt: string) => void;
}

/**
 * The compact prompt editor used by the attached builder design. Reference
 * validity is still enforced by the shared workflow validator and rendered in
 * the inspector's issue list; the field does not repeat the prompt in a second
 * preview block.
 */
export function WorkflowBuilderPromptField({
  fieldId,
  value,
  disabled,
  invalid,
  onChange,
}: WorkflowBuilderPromptFieldProps) {
  return (
    <div className="flex flex-col" style={{ gap: 6 }}>
      <label
        htmlFor={fieldId}
        className={INSPECTOR_EYEBROW_CLASS}
        style={INSPECTOR_EYEBROW_STYLE}
      >
        {WORKFLOW_BUILDER_COPY.promptLabel}
      </label>
      <textarea
        id={fieldId}
        value={value}
        rows={5}
        disabled={disabled}
        aria-invalid={invalid ? "true" : undefined}
        placeholder={WORKFLOW_BUILDER_COPY.promptPlaceholder}
        className="text-ui-sm"
        style={INSPECTOR_TEXTAREA_STYLE}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </div>
  );
}
