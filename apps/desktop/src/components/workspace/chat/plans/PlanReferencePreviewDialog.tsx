import { ModalShell } from "@proliferate/ui/primitives/ModalShell";
import { PlanMarkdownBody } from "@proliferate/product-ui/chat/transcript/PlanMarkdownBody";
import {
  renderTranscriptCodeBlock,
  renderTranscriptInlineCode,
  renderTranscriptLink,
} from "@/components/workspace/chat/transcript/transcript-markdown";
import type { PromptDisplayPlanPart } from "@proliferate/product-domain/chats/composer/prompt-display-parts";

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
            <div className="text-sm text-muted-foreground">
              Plan attachment
            </div>
          </div>
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
