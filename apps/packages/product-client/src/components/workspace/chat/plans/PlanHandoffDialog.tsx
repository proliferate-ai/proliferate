import { useEffect, useMemo, useState } from "react";
import { Button } from "#product/primitives/Button";
import { IconTile } from "#product/primitives/IconTile";
import { ArrowRight, ExternalLink } from "#product/primitives/icons/core";
import { FileText } from "#product/primitives/icons/workspace";
import { ModalShell } from "#product/primitives/patterns/ModalShell";
import { Textarea } from "#product/primitives/Textarea";
import {
  PlanHandoffModePicker,
  type PlanHandoffModePickerProps,
} from "#product/components/workspace/chat/plans/PlanHandoffModePicker";
import { PlanReferencePreviewDialog } from "#product/components/workspace/chat/plans/PlanReferencePreviewDialog";
import { ComposerModelSelectorControl } from "#product/components/workspace/chat/input/ComposerModelSelectorControl";
import type { PromptDisplayPlanPart } from "#product/domain/chats/composer/prompt-display-parts";
import type { PromptPlanAttachmentDescriptor } from "#product/domain/chats/composer/prompt-plan-attachments";
import type { ModelSelectorProps } from "#product/lib/domain/chat/models/model-selector-types";

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
        footerClassName="flex shrink-0 items-center justify-end gap-1.5 border-t border-border/60 bg-surface-elevated-secondary px-4 py-3"
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
              <ArrowRight className="icon-compact" />
            </Button>
          </>
        )}
      >
        <div className="flex flex-col gap-3.5" data-telemetry-mask>
          {plan && (
            <div>
              <div className="mb-1.5 text-ui-sm font-medium text-muted-foreground">
                Attached plan
              </div>
              {/*
                The row's hover and pressed states come from `Button`'s ghost
                variant rather than being written out here (DESIGN_SYSTEM.md
                § UI-conformance review, check 7); only the frame and layout stay
                at the call site.

                Recorded exclusion for check 1: neither landed shape can carry
                this frame. `Card` has no interaction states and only two fills
                (`bg-surface-elevated-secondary` / `bg-card`), and a slotted
                list-row shape fixes its title at `text-heading` (17px) against
                this row's 13px, which would resize a dialog row by a third.
                Folding it in needs a review ruling on one of those APIs, not a
                call-site workaround.
              */}
              <Button
                type="button"
                variant="ghost"
                size="unstyled"
                className="flex w-full min-w-0 items-center gap-2.5 rounded-lg border border-border/70 bg-foreground/5 px-3 py-2.5 text-left text-foreground transition-colors"
                onClick={() => setPreviewOpen(true)}
                aria-label={`Preview attached plan: ${plan.title}`}
              >
                <IconTile>
                  <FileText className="icon-paired" />
                </IconTile>
                <span className="min-w-0 flex-1 truncate text-ui font-medium leading-5">
                  {plan.title}
                </span>
                <ExternalLink className="icon-paired shrink-0 text-muted-foreground/70" />
              </Button>
            </div>
          )}

          <Textarea
            value={promptText}
            onChange={(event) => onPromptTextChange(event.target.value)}
            rows={4}
            className="min-h-24 resize-y rounded-lg border-border/70 bg-foreground/5 px-3.5 py-3 leading-relaxed transition-colors hover:bg-hover focus:bg-active"
            placeholder="Add instructions for the new session (optional)"
          />

          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <ComposerModelSelectorControl modelSelectorProps={modelSelectorProps} />
              <PlanHandoffModePicker
                options={modePickerProps.options}
                value={modePickerProps.value}
                disabled={isSubmitting}
                showHelperText={false}
                onChange={modePickerProps.onChange}
              />
            </div>
            <div className="text-ui-sm text-muted-foreground">
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
