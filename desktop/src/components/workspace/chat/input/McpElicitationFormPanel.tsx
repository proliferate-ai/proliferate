import type { McpElicitationField } from "@anyharness/sdk";
import { Button } from "@/components/ui/Button";
import {
  McpElicitationFieldControl,
  type McpDraftValue,
} from "./McpElicitationFieldControl";
import { McpElicitationInlineError } from "./McpElicitationInlineError";

const BUTTON_CLASSNAME = "rounded-xl px-2.5 text-sm";

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
          <div className="text-sm text-muted-foreground">
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

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 px-3 pb-3 pt-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className={BUTTON_CLASSNAME}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className={BUTTON_CLASSNAME}
          onClick={onDecline}
        >
          Decline
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          className={BUTTON_CLASSNAME}
          onClick={onSubmit}
        >
          Submit
        </Button>
      </div>
    </div>
  );
}
