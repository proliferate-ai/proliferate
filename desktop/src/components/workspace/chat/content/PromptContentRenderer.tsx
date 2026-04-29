import type { ContentPart } from "@anyharness/sdk";
import { FileText, Link2, X } from "@/components/ui/icons";
import { Button } from "@/components/ui/Button";
import { usePromptAttachmentUrl } from "@/hooks/chat/use-prompt-attachment-url";
import type { PromptAttachmentDescriptor } from "@/lib/domain/chat/prompt-content";

export interface PromptContentRendererProps {
  sessionId: string | null;
  parts: readonly ContentPart[];
  fallbackText?: string;
  compact?: boolean;
}

export function PromptContentRenderer({
  sessionId,
  parts,
  fallbackText = "",
  compact = false,
}: PromptContentRendererProps) {
  const visibleParts = parts.length > 0 ? parts : (
    fallbackText ? [{ type: "text" as const, text: fallbackText }] : []
  );

  return (
    <div className={compact ? "flex min-w-0 flex-col gap-1" : "flex min-w-0 flex-col gap-2"}>
      {visibleParts.map((part, index) => (
        <PromptContentPartView
          key={`${part.type}-${index}`}
          sessionId={sessionId}
          part={part}
          compact={compact}
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
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2 px-3 pb-2" data-telemetry-mask>
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className="group flex max-w-full items-center gap-2 rounded-md border border-border/70 bg-muted/35 px-2 py-1 text-xs text-foreground"
        >
          {attachment.objectUrl ? (
            <img
              src={attachment.objectUrl}
              alt=""
              className="size-8 rounded object-cover"
            />
          ) : (
            <FileText className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 max-w-44 truncate">{attachment.name}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onRemove(attachment.id)}
            className="size-6 shrink-0 opacity-65 group-hover:opacity-100"
            aria-label={`Remove ${attachment.name}`}
          >
            <X className="size-3" />
          </Button>
        </div>
      ))}
    </div>
  );
}

function PromptContentPartView({
  sessionId,
  part,
  compact,
}: {
  sessionId: string | null;
  part: ContentPart;
  compact: boolean;
}) {
  switch (part.type) {
    case "text":
      return (
        <div className="whitespace-pre-wrap break-words text-chat">
          {part.text}
        </div>
      );

    case "image":
      return (
        <PromptImagePart
          sessionId={sessionId}
          attachmentId={part.attachmentId}
          name={part.name ?? "attached image"}
          compact={compact}
        />
      );

    case "resource":
      return (
        <div className="flex min-w-0 items-start gap-2 rounded-md border border-border/70 bg-background/40 px-2 py-1.5 text-xs">
          <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-foreground">
              {part.name ?? part.uri}
            </div>
            {part.preview && !compact && (
              <div className="mt-1 line-clamp-3 whitespace-pre-wrap text-muted-foreground">
                {part.preview}
              </div>
            )}
          </div>
        </div>
      );

    case "resource_link":
      return (
        <div className="flex min-w-0 items-center gap-2 rounded-md border border-border/70 bg-background/40 px-2 py-1.5 text-xs">
          <Link2 className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="truncate font-medium text-foreground">{part.name}</div>
            <div className="truncate text-muted-foreground">{part.uri}</div>
          </div>
        </div>
      );

    default:
      return null;
  }
}

function PromptImagePart({
  sessionId,
  attachmentId,
  name,
  compact,
}: {
  sessionId: string | null;
  attachmentId: string;
  name: string;
  compact: boolean;
}) {
  const image = usePromptAttachmentUrl(sessionId, attachmentId);

  if (!image.data) {
    return (
      <div className="rounded-md border border-border/70 bg-muted/30 px-2 py-1 text-xs text-muted-foreground">
        {image.isError ? "Image unavailable" : name}
      </div>
    );
  }

  return (
    <img
      src={image.data}
      alt={name}
      className={
        compact
          ? "max-h-16 max-w-24 rounded object-cover"
          : "max-h-80 max-w-full rounded-md object-contain"
      }
    />
  );
}
