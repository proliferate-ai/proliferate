import { useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { RowActionIconButton } from "@proliferate/ui/primitives/RowActionIconButton";
import { FileText, X } from "@proliferate/ui/icons";
import { CollapsiblePlanCard } from "#product/components/workspace/chat/transcript/CollapsiblePlanCard";
import {
  renderTranscriptCodeBlock,
  renderTranscriptInlineCode,
  renderTranscriptLink,
} from "#product/components/workspace/chat/transcript/transcript-markdown";
import { PlanReferencePreviewDialog } from "#product/components/workspace/chat/plans/PlanReferencePreviewDialog";
import type { PromptDisplayPlanPart } from "@proliferate/product-domain/chats/composer/prompt-display-parts";

type PlanReferenceAttachmentCardVariant = "draft" | "compact" | "transcript";

interface PlanReferenceAttachmentCardProps {
  plan: PromptDisplayPlanPart;
  variant: PlanReferenceAttachmentCardVariant;
  onRemove?: (id: string) => void;
}

export function PlanReferenceAttachmentCard({
  plan,
  variant,
  onRemove,
}: PlanReferenceAttachmentCardProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const isDraft = variant === "draft";
  const isCompact = variant === "compact";
  if (variant === "transcript") {
    return <PlanReferenceTranscriptCard plan={plan} />;
  }

  const className = isDraft
    ? "group relative inline-flex max-w-[260px] items-center gap-1 rounded-full border border-border bg-card px-2 py-1.5 text-chat text-foreground transition-colors hover:bg-hover"
    : isCompact
      ? "inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border border-border/70 bg-card px-2 py-1.5 text-chat text-foreground transition-colors hover:bg-hover"
      : "inline-flex min-w-0 max-w-[260px] items-center gap-1 rounded-full border border-border bg-card px-2 py-1.5 text-chat text-foreground transition-colors hover:bg-hover";

  return (
    <>
      <div
        className={className}
        data-telemetry-mask
        title={`${plan.title}\nPlan`}
      >
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-chat-transcript-ignore
          onClick={() => setPreviewOpen(true)}
          className="flex h-auto min-w-0 flex-1 items-center gap-1 rounded-full bg-transparent px-0 py-0 text-left hover:bg-transparent"
        >
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
            <FileText className="icon-paired" />
          </span>
          <span className="relative min-w-0 flex-1 truncate pr-1 font-medium">
            {plan.title}
          </span>
          <span className="shrink-0 text-ui-sm text-muted-foreground">
            Plan
          </span>
        </Button>
        {isDraft && onRemove && (
          // Full-height reveal veil is the layout wrapper (fades the plan
          // title behind the control); the row-action primitive itself
          // stays visibility="always" and sits at the veil's trailing edge.
          <div
            data-chat-transcript-ignore
            className="pointer-events-none absolute inset-y-0 right-0 flex h-full items-center rounded-full bg-card/95 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
          >
            <RowActionIconButton
              label={`Remove ${plan.title}`}
              visibility="always"
              data-chat-transcript-ignore
              onClick={() => onRemove(plan.id)}
            >
              <X />
            </RowActionIconButton>
          </div>
        )}
      </div>
      <PlanReferencePreviewDialog
        open={previewOpen}
        plan={previewOpen ? plan : null}
        onClose={() => setPreviewOpen(false)}
      />
    </>
  );
}

function PlanReferenceTranscriptCard({ plan }: { plan: PromptDisplayPlanPart }) {
  return (
    <CollapsiblePlanCard
      title={plan.title}
      content={plan.bodyMarkdown}
      subtitle={<span className="shrink-0 text-ui-sm text-muted-foreground">Attached plan</span>}
      emptyContent="No plan content"
      copyLabel="Copy attached plan"
      collapseLabel="Collapse attached plan"
      expandLabel="Expand attached plan"
      initialExpanded={false}
      density="compact"
      renderLink={renderTranscriptLink}
      renderInlineCode={renderTranscriptInlineCode}
      renderCodeBlock={renderTranscriptCodeBlock}
    />
  );
}
