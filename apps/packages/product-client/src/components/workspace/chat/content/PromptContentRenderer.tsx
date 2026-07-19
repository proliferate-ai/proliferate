import type { ContentPart } from "@anyharness/sdk";
import { PlanReferenceAttachmentCard } from "#product/components/workspace/chat/content/PlanReferenceAttachmentCard";
import { PromptAttachmentCard } from "#product/components/workspace/chat/content/PromptAttachmentCard";
import {
  normalizeContentParts,
  normalizeDraftAttachments,
  type PromptDisplayAttachmentPart,
  type PromptDisplayPart,
} from "@proliferate/product-domain/chats/composer/prompt-display-parts";
import type { PromptDraftAttachmentDescriptor } from "@proliferate/product-domain/chats/composer/prompt-attachment-rules";
import { MarkdownBody } from "@proliferate/product-ui/chat/transcript/MarkdownBody";
import { renderTranscriptLink } from "#product/components/workspace/chat/transcript/transcript-markdown";
import { usePromptAttachmentPreviewActions } from "#product/hooks/chat/workflows/use-prompt-attachment-preview-actions";

type PromptContentRendererVariant = "transcript" | "compact";
type PromptContentRendererLayout = "stack" | "wrap" | "auto";

export interface PromptContentRendererProps {
  sessionId: string | null;
  parts: readonly ContentPart[];
  fallbackText?: string;
  compact?: boolean;
  variant?: PromptContentRendererVariant;
  includeText?: boolean;
  includeAttachments?: boolean;
  layout?: PromptContentRendererLayout;
}

export function PromptContentRenderer({
  sessionId,
  parts,
  fallbackText = "",
  compact = false,
  variant,
  includeText = true,
  includeAttachments = true,
  layout = "stack",
}: PromptContentRendererProps) {
  const { openAttachmentPreview } = usePromptAttachmentPreviewActions();
  const displayParts = normalizeContentParts(parts, fallbackText);
  const visibleParts = displayParts.filter((part) => (
    part.type === "text" ? includeText : includeAttachments
  ));
  const resolvedVariant = variant ?? (compact ? "compact" : "transcript");
  const resolvedLayout = resolvePromptContentLayout(layout, visibleParts);

  if (visibleParts.length === 0) {
    return null;
  }

  return (
    <div className={promptContentContainerClassName(resolvedVariant, resolvedLayout)}>
      {visibleParts.map((part) => (
        <PromptDisplayPartView
          key={part.id}
          sessionId={sessionId}
          part={part}
          variant={resolvedVariant}
          onOpenAttachment={(attachment) => openAttachmentPreview({
            part: attachment,
            origin: "session",
            sessionId,
          })}
        />
      ))}
    </div>
  );
}

export interface DraftAttachmentPreviewListProps {
  attachments: readonly PromptDraftAttachmentDescriptor[];
  onRemove: (id: string) => void;
}

export function DraftAttachmentPreviewList({
  attachments,
  onRemove,
}: DraftAttachmentPreviewListProps) {
  const { openAttachmentPreview } = usePromptAttachmentPreviewActions();
  const displayParts = normalizeDraftAttachments(attachments);

  if (displayParts.length === 0) {
    return null;
  }

  return (
    <div className="flex w-full flex-wrap items-start justify-start gap-2 px-2 pt-2 pb-1" data-telemetry-mask>
      {displayParts.map((part) => (
        <PromptAttachmentCard
          key={part.id}
          sessionId={null}
          part={part}
          variant="draft"
          onRemove={onRemove}
          onOpenAttachment={(attachment) => openAttachmentPreview({
            part: attachment,
            origin: "draft",
            sessionId: null,
          })}
        />
      ))}
    </div>
  );
}

function PromptDisplayPartView({
  sessionId,
  part,
  variant,
  onOpenAttachment,
}: {
  sessionId: string | null;
  part: PromptDisplayPart;
  variant: PromptContentRendererVariant;
  onOpenAttachment: (part: Exclude<
    PromptDisplayAttachmentPart,
    { type: "link" | "plan_reference" }
  >) => void;
}) {
  if (part.type === "text") {
    return <FileLinkedText text={part.text} />;
  }

  if (part.type === "plan_reference") {
    return <PlanReferenceAttachmentCard plan={part} variant={variant} />;
  }

  return (
    <PromptAttachmentCard
      sessionId={sessionId}
      part={part}
      variant={variant}
      onOpenAttachment={onOpenAttachment}
    />
  );
}

function FileLinkedText({ text }: { text: string }) {
  return (
    <MarkdownBody
      content={text}
      renderLink={renderTranscriptLink}
      enableContentSearch
      className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
    />
  );
}

function promptContentContainerClassName(
  variant: PromptContentRendererVariant,
  layout: "stack" | "wrap",
): string {
  if (layout === "wrap") {
    return "flex min-w-0 flex-wrap items-end justify-end gap-2";
  }

  return variant === "compact"
    ? "flex min-w-0 flex-col gap-1"
    : "flex min-w-0 flex-col gap-2";
}

function resolvePromptContentLayout(
  layout: PromptContentRendererLayout,
  parts: readonly PromptDisplayPart[],
): "stack" | "wrap" {
  if (layout !== "auto") {
    return layout;
  }
  return parts.some((part) => part.type === "plan_reference") ? "stack" : "wrap";
}
