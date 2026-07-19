import { FileIcon, Link2, Spinner, X } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import type { PromptDisplayAttachmentPart } from "@proliferate/product-domain/chats/composer/prompt-display-parts";
import { FileTreeEntryIcon } from "#product/components/workspace/files/file-icons";
import { PlanReferenceAttachmentCard } from "#product/components/workspace/chat/content/PlanReferenceAttachmentCard";
import { usePromptAttachmentUrl } from "#product/hooks/access/anyharness/sessions/use-prompt-attachment-url";

type PromptAttachmentCardVariant = "transcript" | "compact" | "draft";
type NonPlanPromptAttachmentPart = Exclude<
  PromptDisplayAttachmentPart,
  { type: "plan_reference" }
>;

export function PromptAttachmentCard({
  sessionId,
  part,
  variant,
  onRemove,
  onOpenAttachment,
}: {
  sessionId: string | null;
  part: PromptDisplayAttachmentPart;
  variant: PromptAttachmentCardVariant;
  onRemove?: (id: string) => void;
  onOpenAttachment?: (part: Exclude<
    PromptDisplayAttachmentPart,
    { type: "link" | "plan_reference" }
  >) => void;
}) {
  if (part.type === "plan_reference") {
    return (
      <PlanReferenceAttachmentCard
        plan={part}
        variant={variant}
        onRemove={onRemove}
      />
    );
  }

  const isDraft = variant === "draft";
  const isCompact = variant === "compact";
  const isImage = part.type === "image";
  const canPreview = part.type === "image" || part.type === "file";
  const metadata = [attachmentTypeLabel(part), part.sizeLabel]
    .filter(Boolean)
    .join(" · ");
  const title = [part.name, metadata, part.type === "link" ? part.uri : null]
    .filter(Boolean)
    .join("\n");
  const className = promptAttachmentCardClassName({ isCompact, isDraft, isImage });

  return (
    <div
      className={className}
      data-telemetry-mask
      style={isDraft && !isImage ? { height: 52, width: 210 } : undefined}
      title={title}
    >
      {canPreview && onOpenAttachment ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-chat-transcript-ignore
          onClick={(event) => {
            event.stopPropagation();
            onOpenAttachment(part);
          }}
          className="absolute inset-0 z-0 h-full w-full rounded-[inherit] bg-transparent p-0 hover:bg-foreground/[0.045] focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
          aria-label={`Preview ${part.name}`}
        />
      ) : null}
      <div className={isImage
        ? "pointer-events-none relative z-10 size-full overflow-hidden rounded-[inherit]"
        : "pointer-events-none relative z-10 flex size-full min-w-0 items-center gap-2 p-2 pr-7"}
      >
        <PromptAttachmentPreview
          sessionId={sessionId}
          part={part}
          variant={variant}
        />
        {!isImage ? (
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-foreground">
              {part.name}
            </div>
            {metadata ? (
              <div className="truncate text-xs leading-4 text-muted-foreground">
                {metadata}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {isDraft && onRemove && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          data-chat-transcript-ignore
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onRemove(part.id);
          }}
          className="prompt-attachment-remove pointer-events-none absolute top-1 right-1 z-20 size-5 rounded-full border border-border bg-background/95 p-0 text-foreground opacity-0 shadow-sm transition-opacity"
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
  part: NonPlanPromptAttachmentPart;
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
    <div
      className={previewFrameClassName(variant)}
      title={image.isError ? "Image unavailable" : "Loading image"}
    >
      {image.isLoading ? (
        <Spinner className="size-4 text-muted-foreground" />
      ) : (
        <FileIcon className="size-4 text-muted-foreground" />
      )}
    </div>
  );
}

function previewFrameClassName(variant: PromptAttachmentCardVariant): string {
  return variant === "compact"
    ? "flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/70"
    : "flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/70";
}

function imageClassName(variant: PromptAttachmentCardVariant): string {
  return variant === "compact"
    ? "size-full object-cover opacity-90"
    : "size-full object-cover";
}

function attachmentTypeLabel(part: PromptDisplayAttachmentPart): string {
  switch (part.type) {
    case "image":
      return "Image";
    case "file":
      if (part.source === "paste") {
        return "Pasted text";
      }
      return attachmentExtension(part.name) ?? "Text file";
    case "link":
      return "Link";
    case "plan_reference":
      return "Plan";
  }
}

function attachmentExtension(name: string): string | null {
  const extension = name.split(".").pop();
  return extension && extension !== name ? extension.toUpperCase() : null;
}

function promptAttachmentCardClassName(args: {
  isCompact: boolean;
  isDraft: boolean;
  isImage: boolean;
}): string {
  if (args.isImage) {
    const size = args.isDraft ? "size-20" : args.isCompact ? "size-10" : "size-14";
    const border = args.isDraft ? "border-border" : "border-border/60";
    return `prompt-attachment-card relative inline-flex ${size} shrink-0 overflow-visible rounded-lg border ${border} bg-card text-foreground`;
  }
  if (args.isDraft) {
    return "prompt-attachment-card relative inline-flex max-w-full shrink-0 overflow-visible rounded-lg border border-border bg-card text-foreground";
  }
  if (args.isCompact) {
    return "prompt-attachment-card relative inline-flex h-10 w-44 max-w-full shrink-0 overflow-visible rounded-lg border border-border/50 bg-card/70 text-foreground";
  }
  return "prompt-attachment-card relative inline-flex h-11 w-48 max-w-full shrink-0 overflow-visible rounded-lg border border-border/60 bg-card/80 text-foreground";
}
