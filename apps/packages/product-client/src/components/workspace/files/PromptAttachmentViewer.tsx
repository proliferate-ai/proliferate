import { useEffect, useState, type ReactNode } from "react";
import { FileIcon, FileText, Spinner } from "@proliferate/ui/icons";
import { formatPromptFileSize } from "@proliferate/product-domain/chats/composer/prompt-attachment-rules";
import { usePromptAttachmentUrl } from "#product/hooks/access/anyharness/sessions/use-prompt-attachment-url";
import {
  usePromptAttachmentBlobText,
  usePromptAttachmentObjectUrlText,
} from "#product/hooks/access/prompt-attachments/use-prompt-attachment-text";
import type { ViewerTarget } from "#product/lib/domain/workspaces/viewer/viewer-target";

type PromptAttachmentTarget = Extract<ViewerTarget, { kind: "promptAttachment" }>;

export function PromptAttachmentViewer({ target }: { target: PromptAttachmentTarget }) {
  return target.origin === "draft"
    ? <DraftPromptAttachmentViewer target={target} />
    : <SessionPromptAttachmentViewer target={target} />;
}

function DraftPromptAttachmentViewer({ target }: { target: PromptAttachmentTarget }) {
  const text = usePromptAttachmentObjectUrlText(
    target.attachmentKind === "text_resource" ? target.objectUrl : null,
  );
  return (
    <PromptAttachmentViewerSurface
      target={target}
      src={target.objectUrl}
      text={text.data}
      isLoading={text.isLoading}
      isError={text.isError || !target.objectUrl}
    />
  );
}

function SessionPromptAttachmentViewer({ target }: { target: PromptAttachmentTarget }) {
  const resource = usePromptAttachmentUrl(target.sessionId, target.attachmentId);
  const text = usePromptAttachmentBlobText(
    target.attachmentKind === "text_resource" ? resource.blob : null,
  );
  return (
    <PromptAttachmentViewerSurface
      target={target}
      src={resource.data}
      text={text.data}
      isLoading={resource.isLoading || text.isLoading}
      isError={resource.isError || text.isError || !target.sessionId}
    />
  );
}

function PromptAttachmentViewerSurface({
  target,
  src,
  text,
  isLoading,
  isError,
}: {
  target: PromptAttachmentTarget;
  src: string | null;
  text: string | null;
  isLoading: boolean;
  isError: boolean;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const metadata = [
    target.attachmentSource === "paste" ? "Pasted text" : target.mimeType,
    formatPromptFileSize(target.size),
    "Read only",
  ].filter(Boolean).join(" · ");

  useEffect(() => {
    setImageFailed(false);
  }, [src]);

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
      data-prompt-attachment-viewer
      data-telemetry-mask
    >
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border/60 px-3 text-xs text-muted-foreground">
        {target.attachmentKind === "image" ? (
          <FileIcon className="icon-paired shrink-0 [font-size:var(--text-sidebar-row)]" />
        ) : (
          <FileText className="icon-paired shrink-0" />
        )}
        <span className="truncate">{metadata}</span>
      </div>
      <div className="relative min-h-0 flex-1">
        {isLoading ? (
          <PreviewStatus icon={<Spinner className="icon-large" />} label="Loading attachment preview…" />
        ) : isError || (target.attachmentKind === "image" ? !src || imageFailed : text === null) ? (
          <PreviewStatus
            icon={<FileIcon className="icon-large" />}
            label="Attachment preview unavailable"
            detail="The attachment was removed or could not be read."
          />
        ) : target.attachmentKind === "image" ? (
          <div className="flex size-full items-center justify-center overflow-auto p-4">
            <img
              src={src!}
              alt={target.name}
              className="max-h-full max-w-full rounded-lg object-contain shadow-sm"
              onError={() => setImageFailed(true)}
            />
          </div>
        ) : (
          <pre className="size-full overflow-auto p-3 font-mono text-[length:var(--readable-code-font-size)] leading-[var(--readable-code-line-height)] text-foreground">
            <code className={target.attachmentSource === "paste" ? "whitespace-pre-wrap" : "whitespace-pre"}>
              {text}
            </code>
          </pre>
        )}
      </div>
    </div>
  );
}

function PreviewStatus({
  icon,
  label,
  detail,
}: {
  icon: ReactNode;
  label: string;
  detail?: string;
}) {
  return (
    <div className="flex size-full items-center justify-center p-6 text-center">
      <div className="flex max-w-64 flex-col items-center gap-2 text-muted-foreground">
        {icon}
        <div className="text-sm font-medium text-foreground">{label}</div>
        {detail ? <div className="text-xs leading-5">{detail}</div> : null}
      </div>
    </div>
  );
}
