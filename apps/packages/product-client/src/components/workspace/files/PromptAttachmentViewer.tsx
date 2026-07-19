import { useEffect, useState, type ReactNode } from "react";
import { FileIcon, FileText, Spinner } from "@proliferate/ui/icons";
import { formatPromptFileSize } from "@proliferate/product-domain/chats/composer/prompt-attachment-rules";
import { usePromptAttachmentUrl } from "#product/hooks/access/anyharness/sessions/use-prompt-attachment-url";
import type { ViewerTarget } from "#product/lib/domain/workspaces/viewer/viewer-target";

type PromptAttachmentTarget = Extract<ViewerTarget, { kind: "promptAttachment" }>;

export function PromptAttachmentViewer({ target }: { target: PromptAttachmentTarget }) {
  return target.origin === "draft"
    ? <DraftPromptAttachmentViewer target={target} />
    : <SessionPromptAttachmentViewer target={target} />;
}

function DraftPromptAttachmentViewer({ target }: { target: PromptAttachmentTarget }) {
  const text = useObjectUrlText(
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
  const text = useBlobText(
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
          <FileIcon className="size-3.5 shrink-0" />
        ) : (
          <FileText className="size-3.5 shrink-0" />
        )}
        <span className="truncate">{metadata}</span>
      </div>
      <div className="relative min-h-0 flex-1">
        {isLoading ? (
          <PreviewStatus icon={<Spinner className="size-5" />} label="Loading attachment preview…" />
        ) : isError || (target.attachmentKind === "image" ? !src || imageFailed : text === null) ? (
          <PreviewStatus
            icon={<FileIcon className="size-5" />}
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

function useObjectUrlText(objectUrl: string | null) {
  const [state, setState] = useState<{
    data: string | null;
    isLoading: boolean;
    isError: boolean;
  }>({ data: null, isLoading: false, isError: false });

  useEffect(() => {
    let cancelled = false;
    if (!objectUrl) {
      setState({ data: null, isLoading: false, isError: false });
      return;
    }
    setState({ data: null, isLoading: true, isError: false });
    void fetch(objectUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Attachment preview failed with ${response.status}`);
        }
        return response.text();
      })
      .then((data) => {
        if (!cancelled) {
          setState({ data, isLoading: false, isError: false });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ data: null, isLoading: false, isError: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [objectUrl]);

  return state;
}

function useBlobText(blob: Blob | null) {
  const [state, setState] = useState<{
    data: string | null;
    isLoading: boolean;
    isError: boolean;
  }>({ data: null, isLoading: false, isError: false });

  useEffect(() => {
    let cancelled = false;
    if (!blob) {
      setState({ data: null, isLoading: false, isError: false });
      return;
    }
    setState({ data: null, isLoading: true, isError: false });
    void blob.text()
      .then((data) => {
        if (!cancelled) {
          setState({ data, isLoading: false, isError: false });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ data: null, isLoading: false, isError: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [blob]);

  return state;
}
