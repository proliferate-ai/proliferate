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
}

export function PromptContentRenderer({
  sessionId,
  parts,
  fallbackText = "",
  compact = false,
  variant,
}: PromptContentRendererProps) {
  const displayParts = normalizeContentParts(parts, fallbackText);
  const resolvedVariant = variant ?? (compact ? "compact" : "transcript");

  if (displayParts.length === 0) {
    return null;
  }

  return (
    <div className={resolvedVariant === "compact" ? "flex min-w-0 flex-col gap-1" : "flex min-w-0 flex-col gap-2"}>
      {displayParts.map((part) => (
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
    <div className="flex flex-wrap gap-2 px-3 pb-2" data-telemetry-mask>
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
  const className = isDraft
    ? "group flex max-w-full items-center gap-2 rounded-md border border-border/70 bg-muted/35 px-2 py-1 text-xs text-foreground"
    : isCompact
      ? "flex min-w-0 items-center gap-2 rounded-md border border-border/60 bg-muted/45 px-2 py-1.5 text-xs text-foreground"
      : "flex min-w-0 items-start gap-2 rounded-lg border border-border/60 bg-muted/45 px-2.5 py-2 text-xs text-foreground shadow-sm";

  return (
    <div className={className} data-telemetry-mask>
      <PromptAttachmentPreview
        sessionId={sessionId}
        part={part}
        variant={variant}
      />
      <div className={isDraft ? "min-w-0 max-w-44" : "min-w-0 flex-1"}>
        <div className="truncate font-medium text-foreground" title={part.name}>
          {part.name}
        </div>
        {metadata && (
          <div className="truncate text-muted-foreground">
            {metadata}
          </div>
        )}
        {part.type === "link" && !isDraft && (
          <div className="truncate text-muted-foreground" title={part.uri}>
            {part.uri}
          </div>
        )}
        {part.preview && !isCompact && !isDraft && (
          <div className="mt-1 line-clamp-3 whitespace-pre-wrap text-muted-foreground">
            {part.preview}
          </div>
        )}
      </div>
      {isDraft && onRemove && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => onRemove(part.id)}
          className="size-6 shrink-0 opacity-65 group-hover:opacity-100"
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
        <Link2 className="size-4 text-muted-foreground" />
      ) : (
        <FileTreeEntryIcon
          name={part.name}
          path={part.uri ?? part.name}
          kind="file"
          className="size-4 text-muted-foreground"
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
  if (variant === "draft") {
    return "flex size-8 shrink-0 items-center justify-center rounded bg-foreground/5";
  }
  if (variant === "compact") {
    return "flex size-8 shrink-0 items-center justify-center rounded bg-foreground/5";
  }
  return "flex size-10 shrink-0 items-center justify-center rounded-md bg-foreground/5";
}

function imageClassName(variant: PromptAttachmentCardVariant): string {
  if (variant === "draft" || variant === "compact") {
    return "size-8 shrink-0 rounded object-cover";
  }
  return "size-10 shrink-0 rounded-md object-cover";
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
