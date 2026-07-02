import type { McpElicitationField } from "@anyharness/sdk";
import { ComposerCardFooter } from "./ComposerAttachedPanel";
import {
  McpElicitationFieldControl,
  type McpDraftValue,
} from "./McpElicitationFieldControl";
import { McpElicitationInlineError } from "./McpElicitationInlineError";

interface McpElicitationFormPanelProps {
  message: string;
  fields: McpElicitationField[];
  drafts: Partial<Record<string, McpDraftValue>>;
  error: string | null;
  onFieldChange: (fieldId: string, value: McpDraftValue) => void;
  onCancel: () => void;
  onDecline: () => void;
  onSubmit: () => void;
}

export function McpElicitationFormPanel({
  message,
  fields,
  drafts,
  error,
  onFieldChange,
  onCancel,
  onDecline,
  onSubmit,
}: McpElicitationFormPanelProps) {
  return (
    <div className="flex max-h-[min(40vh,360px)] flex-col">
      <div className="min-h-0 overflow-y-auto p-3 pb-2">
        <div className="flex flex-col gap-3">
          <div className="text-ui-sm text-muted-foreground">
            {message}
          </div>
          <div className="flex flex-col gap-3">
            {fields.map((field) => (
              <McpElicitationFieldControl
                key={field.fieldId}
                field={field}
                value={drafts[field.fieldId]}
                onChange={(value) => onFieldChange(field.fieldId, value)}
              />
            ))}
          </div>
          {error && <McpElicitationInlineError message={error} />}
        </div>
      </div>

      <ComposerCardFooter
        secondaryActions={[
          { label: "Cancel", onSelect: onCancel },
          { label: "Decline", onSelect: onDecline },
        ]}
        primaryAction={{ label: "Submit", onSelect: onSubmit }}
      />
    </div>
  );
}
