import { ModalShell } from "#product/primitives/patterns/ModalShell";
import { PlanMarkdownBody } from "#product/components/workspace/chat/transcript/PlanMarkdownBody";
import {
  renderTranscriptCodeBlock,
  renderTranscriptInlineCode,
  renderTranscriptLink,
} from "#product/components/workspace/chat/transcript/transcript-markdown";
import type { PromptDisplayPlanPart } from "#product/domain/chats/composer/prompt-display-parts";

interface PlanReferencePreviewDialogProps {
  open: boolean;
  plan: PromptDisplayPlanPart | null;
  onClose: () => void;
}

export function PlanReferencePreviewDialog({
  open,
  plan,
  onClose,
}: PlanReferencePreviewDialogProps) {
  return (
    <ModalShell
      open={open && plan !== null}
      onClose={onClose}
      title="Attached plan"
      description="Attached plan preview"
      sizeClassName="max-w-3xl"
      bodyClassName="max-h-[min(44rem,82vh)] overflow-y-auto px-5 pb-5 pt-4"
    >
      {plan && (
        <div className="space-y-3" data-telemetry-mask>
          <div>
            <div className="text-ui font-semibold leading-tight text-foreground">
              {plan.title}
            </div>
            <div className="text-ui-sm text-muted-foreground">
              Plan attachment
            </div>
          </div>
          {/*
            Recorded exclusion (DESIGN_SYSTEM.md § UI-conformance review,
            check 1): the translucent `bg-card/85` over the dialog scrim is what
            keeps this preview reading as a sheet inside a sheet. `Card`'s two
            fills are the opaque `bg-card` and the borderless tint, and neither
            carries an alpha. Shares the shape with CollapsiblePlanCard's shell;
            both land together once `Card` can express it.
          */}
          <div className="rounded-lg border border-border/70 bg-card/85 px-4 py-3">
            <PlanMarkdownBody
              content={plan.bodyMarkdown}
              renderLink={renderTranscriptLink}
              renderInlineCode={renderTranscriptInlineCode}
              renderCodeBlock={renderTranscriptCodeBlock}
            />
          </div>
        </div>
      )}
    </ModalShell>
  );
}
