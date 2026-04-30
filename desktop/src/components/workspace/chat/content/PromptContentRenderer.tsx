import { Fragment } from "react";
import type { ContentPart } from "@anyharness/sdk";
import { FileIcon, Link2, LoaderCircle, X } from "@/components/ui/icons";
import { Button } from "@/components/ui/Button";
import { FilePathLink } from "@/components/ui/content/FilePathLink";
import { FileTreeEntryIcon } from "@/components/ui/file-icons";
import { usePromptAttachmentUrl } from "@/hooks/chat/use-prompt-attachment-url";
import {
  normalizeContentParts,
  normalizeDraftAttachments,
  type PromptAttachmentDescriptor,
  type PromptDisplayAttachmentPart,
  type PromptDisplayPart,
} from "@/lib/domain/chat/prompt-content";
import { tokenizeSerializedFileLinks } from "@/lib/domain/chat/file-mention-links";

type PromptContentRendererVariant = "transcript" | "compact";
type PromptAttachmentCardVariant = PromptContentRendererVariant | "draft";

export interface PromptContentRendererProps {
  sessionId: string | null;
  parts: readonly ContentPart[];
  fallbackText?: string;
  compact?: boolean;
  variant?: PromptContentRendererVariant;
  includeText?: boolean;
  includeAttachments?: boolean;
  layout?: "stack" | "wrap";
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
  const displayParts = normalizeContentParts(parts, fallbackText);
  const visibleParts = displayParts.filter((part) => (
    part.type === "text" ? includeText : includeAttachments
  ));
  const resolvedVariant = variant ?? (compact ? "compact" : "transcript");

  if (visibleParts.length === 0) {
    return null;
  }

  return (
    <div className={promptContentContainerClassName(resolvedVariant, layout)}>
      {visibleParts.map((part) => (
        <PromptDisplayPartView
          key={part.id}
          sessionId={sessionId}
          part={part}
          variant={resolvedVariant}
        />
      ))}
    </div>
  );
}

export interface DraftAttachmentPreviewListProps {
  attachments: readonly PromptAttachmentDescriptor[];
  onRemove: (id: string) => void;
}

export function DraftAttachmentPreviewList({
  attachments,
  onRemove,
}: DraftAttachmentPreviewListProps) {
  const displayParts = normalizeDraftAttachments(attachments);

  if (displayParts.length === 0) {
    return null;
  }

  return (
    <div className="flex w-full flex-wrap items-center justify-start gap-1 px-2 py-1.5" data-telemetry-mask>
      {displayParts.map((part) => (
        <PromptAttachmentCard
          key={part.id}
          sessionId={null}
          part={part}
          variant="draft"
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}

function PromptDisplayPartView({
  sessionId,
  part,
  variant,
}: {
  sessionId: string | null;
  part: PromptDisplayPart;
  variant: PromptContentRendererVariant;
}) {
  if (part.type === "text") {
    return part.isFallback ? (
      <LegacyTextFallback text={part.text} />
    ) : (
      <div className="whitespace-pre-wrap break-words text-chat">
        {part.text}
      </div>
    );
  }

  return (
    <PromptAttachmentCard
      sessionId={sessionId}
      part={part}
      variant={variant}
    />
  );
}

function LegacyTextFallback({ text }: { text: string }) {
  const tokens = tokenizeSerializedFileLinks(text);

  return (
    <div className="whitespace-pre-wrap break-words text-chat">
      {tokens.map((token, index) => {
        if (token.type === "text") {
          return <Fragment key={`text-${index}`}>{token.text}</Fragment>;
        }
        return (
          <FilePathLink key={`${token.path}-${index}`} rawPath={token.path}>
            {token.label}
          </FilePathLink>
        );
      })}
    </div>
  );
}

function PromptAttachmentCard({
  sessionId,
  part,
  variant,
  onRemove,
}: {
  sessionId: string | null;
  part: PromptDisplayAttachmentPart;
  variant: PromptAttachmentCardVariant;
  onRemove?: (id: string) => void;
}) {
  const isDraft = variant === "draft";
  const isCompact = variant === "compact";
  const metadata = [attachmentKindLabel(part), part.mimeType, part.sizeLabel]
    .filter(Boolean)
    .join(" - ");
  const title = [part.name, metadata, part.type === "link" ? part.uri : null]
    .filter(Boolean)
    .join("\n");
  const className = isDraft
    ? "group relative inline-flex max-w-[240px] items-center gap-1 rounded-full border border-border bg-card px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-accent"
    : isCompact
      ? "inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border border-border/70 bg-card px-2 py-1.5 text-xs text-foreground transition-colors hover:bg-accent"
      : "inline-flex min-w-0 max-w-[240px] items-center gap-1 rounded-full border border-border bg-card px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-accent";

  return (
    <div className={className} data-telemetry-mask title={title}>
      <PromptAttachmentPreview
        sessionId={sessionId}
        part={part}
        variant={variant}
      />
      <div className={isDraft ? "relative min-w-0 flex-1 truncate pr-5 font-medium" : "relative min-w-0 flex-1 truncate pr-1 font-medium"}>
        <div className="truncate text-foreground">
          {part.name}
        </div>
      </div>
      {isDraft && onRemove && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => onRemove(part.id)}
          className="pointer-events-none absolute inset-y-0 right-0 h-full w-7 rounded-full bg-card/95 px-0 opacity-0 transition-opacity hover:bg-accent group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
          aria-label={`Remove ${part.name}`}
        >
          <X className="size-3" />
        </Button>
      )}
    </div>
  );
}

function PromptAttachmentPreview({
  sessionId,
  part,
  variant,
}: {
  sessionId: string | null;
  part: PromptDisplayAttachmentPart;
  variant: PromptAttachmentCardVariant;
}) {
  if (part.type === "image") {
    return (
      <PromptImagePreview
        sessionId={sessionId}
        attachmentId={part.attachmentId}
        objectUrl={part.objectUrl}
        name={part.name}
        variant={variant}
      />
    );
  }

  return (
    <div className={previewFrameClassName(variant)}>
      {part.type === "link" ? (
        <Link2 className="size-3.5 text-muted-foreground" />
      ) : (
        <FileTreeEntryIcon
          name={part.name}
          path={part.uri ?? part.name}
          kind="file"
          className="size-3.5 text-muted-foreground"
        />
      )}
    </div>
  );
}

function PromptImagePreview({
  sessionId,
  attachmentId,
  objectUrl,
  name,
  variant,
}: {
  sessionId: string | null;
  attachmentId?: string;
  objectUrl?: string | null;
  name: string;
  variant: PromptAttachmentCardVariant;
}) {
  const image = usePromptAttachmentUrl(
    objectUrl ? null : sessionId,
    objectUrl ? null : attachmentId,
  );
  const src = objectUrl ?? image.data ?? null;

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={imageClassName(variant)}
      />
    );
  }

  return (
    <div className={previewFrameClassName(variant)} title={image.isError ? "Image unavailable" : "Loading image"}>
      {image.isLoading ? (
        <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
      ) : (
        <FileIcon className="size-4 text-muted-foreground" />
      )}
    </div>
  );
}

function previewFrameClassName(variant: PromptAttachmentCardVariant): string {
  if (variant === "compact") {
    return "flex size-4 shrink-0 items-center justify-center";
  }
  return "flex size-4 shrink-0 items-center justify-center";
}

function imageClassName(variant: PromptAttachmentCardVariant): string {
  return variant === "compact"
    ? "size-4 shrink-0 rounded object-cover"
    : "size-4 shrink-0 rounded object-cover";
}

function attachmentKindLabel(part: PromptDisplayAttachmentPart): string {
  switch (part.type) {
    case "image":
      return "Image";
    case "file":
      return "File";
    case "link":
      return "Link";
  }
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
