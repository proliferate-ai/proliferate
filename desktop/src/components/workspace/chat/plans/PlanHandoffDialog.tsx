import { Button } from "@/components/ui/Button";
import { ModalShell } from "@/components/ui/ModalShell";
import { Textarea } from "@/components/ui/Textarea";
import { ModelSelector } from "@/components/workspace/chat/input/ModelSelector";
import { PromptContentRenderer } from "@/components/workspace/chat/content/PromptContentRenderer";
import {
  PlanHandoffModePicker,
  type PlanHandoffModePickerProps,
} from "@/components/workspace/chat/plans/PlanHandoffModePicker";
import {
  planReferenceContentPartFromDescriptor,
  type PromptPlanAttachmentDescriptor,
} from "@/lib/domain/chat/composer/prompt-content";
import type { ModelSelectorProps } from "@/lib/domain/chat/models/model-selection";

interface PlanHandoffDialogProps {
  open: boolean;
  plan: PromptPlanAttachmentDescriptor | null;
  promptText: string;
  modelSelectorProps: ModelSelectorProps;
  modePickerProps: PlanHandoffModePickerProps;
  isSubmitting: boolean;
  onPromptTextChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}

export function PlanHandoffDialog({
  open,
  plan,
  promptText,
  modelSelectorProps,
  modePickerProps,
  isSubmitting,
  onPromptTextChange,
  onClose,
  onSubmit,
}: PlanHandoffDialogProps) {
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      disableClose={isSubmitting}
      title="Hand off plan"
      description="Start a new session with this plan attached."
      sizeClassName="max-w-xl"
      footer={(
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={onSubmit}
            loading={isSubmitting}
          >
            Start new session
          </Button>
        </>
      )}
    >
      <div className="space-y-3" data-telemetry-mask>
        {plan && (
          <PromptContentRenderer
            sessionId={null}
            parts={[planReferenceContentPartFromDescriptor(plan)]}
            compact
          />
        )}
        <Textarea
          value={promptText}
          onChange={(event) => onPromptTextChange(event.target.value)}
          rows={5}
          className="min-h-28"
          placeholder="Prompt for the new session"
        />
        <div className="flex flex-wrap items-start gap-2">
          <ModelSelector {...modelSelectorProps} />
          <PlanHandoffModePicker
            options={modePickerProps.options}
            value={modePickerProps.value}
            disabled={isSubmitting}
            onChange={modePickerProps.onChange}
          />
        </div>
      </div>
    </ModalShell>
  );
}
