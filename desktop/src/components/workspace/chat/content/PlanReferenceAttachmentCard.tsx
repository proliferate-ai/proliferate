import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FileText, X } from "@/components/ui/icons";
import { CollapsiblePlanCard } from "@/components/workspace/chat/content/CollapsiblePlanCard";
import { PlanReferencePreviewDialog } from "@/components/workspace/chat/plans/PlanReferencePreviewDialog";
import type { PromptDisplayPlanPart } from "@/lib/domain/chat/composer/prompt-content";

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
    ? "group relative inline-flex max-w-[260px] items-center gap-1 rounded-full border border-border bg-card px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-accent"
    : isCompact
      ? "inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border border-border/70 bg-card px-2 py-1.5 text-xs text-foreground transition-colors hover:bg-accent"
      : "inline-flex min-w-0 max-w-[260px] items-center gap-1 rounded-full border border-border bg-card px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-accent";

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
            <FileText className="size-3.5" />
          </span>
          <span className="relative min-w-0 flex-1 truncate pr-1 font-medium">
            {plan.title}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            Plan
          </span>
        </Button>
        {isDraft && onRemove && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-chat-transcript-ignore
            onClick={() => onRemove(plan.id)}
            className="pointer-events-none absolute inset-y-0 right-0 h-full w-7 rounded-full bg-card/95 px-0 opacity-0 transition-opacity hover:bg-accent group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
            aria-label={`Remove ${plan.title}`}
          >
            <X className="size-3" />
          </Button>
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
      subtitle={<span className="shrink-0 text-xs text-muted-foreground">Attached plan</span>}
      emptyContent="No plan content"
      copyLabel="Copy attached plan"
      collapseLabel="Collapse attached plan"
      expandLabel="Expand attached plan"
      initialExpanded={false}
    />
  );
}
