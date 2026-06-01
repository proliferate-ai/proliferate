import { useEffect, useMemo, useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ArrowRight, ExternalLink, FileText } from "@proliferate/ui/icons";
import { ModalShell } from "@proliferate/ui/primitives/ModalShell";
import { Textarea } from "@proliferate/ui/primitives/Textarea";
import {
  PlanHandoffModePicker,
  type PlanHandoffModePickerProps,
} from "@/components/workspace/chat/plans/PlanHandoffModePicker";
import { PlanReferencePreviewDialog } from "@/components/workspace/chat/plans/PlanReferencePreviewDialog";
import { ModelSelector } from "@/components/workspace/chat/input/ModelSelector";
import type { PromptDisplayPlanPart } from "@proliferate/product-domain/chats/composer/prompt-display-parts";
import type { PromptPlanAttachmentDescriptor } from "@proliferate/product-domain/chats/composer/prompt-plan-attachments";
import type { ModelSelectorProps } from "@/lib/domain/chat/models/model-selector-types";

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
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewPlan = useMemo(
    () => plan ? displayPlanPartFromDescriptor(plan) : null,
    [plan],
  );

  useEffect(() => {
    if (!open) {
      setPreviewOpen(false);
    }
  }, [open]);

  return (
    <>
      <ModalShell
        open={open}
        onClose={onClose}
        disableClose={isSubmitting}
        title="Start from plan"
        description="Create a new session with this plan attached."
        sizeClassName="max-w-[32.5rem]"
        bodyClassName="px-5 pb-[18px] pt-0"
        footerClassName="flex shrink-0 items-center justify-end gap-1.5 border-t border-border/60 bg-foreground/[0.025] px-4 py-3"
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
              Start session
              <ArrowRight className="size-3" />
            </Button>
          </>
        )}
      >
        <div className="flex flex-col gap-3.5" data-telemetry-mask>
          {plan && (
            <div>
              <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">
                Attached plan
              </div>
              <Button
                type="button"
                variant="unstyled"
                size="unstyled"
                className="flex w-full min-w-0 items-center gap-2.5 rounded-lg border border-border/70 bg-foreground/5 px-3 py-2.5 text-left text-foreground transition-colors hover:border-border hover:bg-foreground/10"
                onClick={() => setPreviewOpen(true)}
                aria-label={`Preview attached plan: ${plan.title}`}
              >
                <span className="grid size-[26px] shrink-0 place-items-center rounded-md bg-foreground/10 text-muted-foreground">
                  <FileText className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium leading-5">
                  {plan.title}
                </span>
                <ExternalLink className="size-3.5 shrink-0 text-muted-foreground/70" />
              </Button>
            </div>
          )}

          <Textarea
            value={promptText}
            onChange={(event) => onPromptTextChange(event.target.value)}
            rows={4}
            className="min-h-24 resize-y rounded-lg border-border/70 bg-foreground/5 px-3.5 py-3 leading-relaxed transition-colors hover:bg-foreground/[0.075] focus:bg-foreground/[0.075]"
            placeholder="Add instructions for the new session (optional)"
          />

          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <ModelSelector {...modelSelectorProps} />
              <PlanHandoffModePicker
                options={modePickerProps.options}
                value={modePickerProps.value}
                disabled={isSubmitting}
                showHelperText={false}
                onChange={modePickerProps.onChange}
              />
            </div>
            <div className="text-xs text-muted-foreground">
              Model and handoff mode apply to this session only.
            </div>
          </div>
        </div>
      </ModalShell>

      <PlanReferencePreviewDialog
        open={open && previewOpen}
        plan={previewPlan}
        onClose={() => setPreviewOpen(false)}
      />
    </>
  );
}

function displayPlanPartFromDescriptor(
  plan: PromptPlanAttachmentDescriptor,
): PromptDisplayPlanPart {
  return {
    type: "plan_reference",
    id: plan.id,
    name: plan.title,
    planId: plan.planId,
    title: plan.title,
    bodyMarkdown: plan.bodyMarkdown,
    snapshotHash: plan.snapshotHash,
    sourceSessionId: plan.sourceSessionId,
    sourceTurnId: plan.sourceTurnId ?? null,
    sourceItemId: plan.sourceItemId ?? null,
    sourceKind: plan.sourceKind,
    sourceToolCallId: plan.sourceToolCallId ?? null,
    ...(plan.resolutionState ? { resolutionState: plan.resolutionState } : {}),
    ...(plan.resolutionMessage ? { resolutionMessage: plan.resolutionMessage } : {}),
  };
}
