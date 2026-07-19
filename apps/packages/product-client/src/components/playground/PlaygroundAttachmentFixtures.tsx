import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ContentPart } from "@anyharness/sdk";
import { useQueryClient } from "@tanstack/react-query";
import { ChatComposerSurface } from "@proliferate/product-ui/chat/composer/ChatComposerSurface";
import { ComposerTextarea } from "@proliferate/ui/primitives/ComposerTextarea";
import { ComposerTextareaFrame } from "@proliferate/ui/primitives/ComposerTextareaFrame";
import { DraftAttachmentPreviewList } from "#product/components/workspace/chat/content/PromptContentRenderer";
import { UserMessage } from "#product/components/workspace/chat/transcript/UserMessage";
import { PromptAttachmentViewer } from "#product/components/workspace/files/PromptAttachmentViewer";
import { ViewerHeaderButton } from "#product/components/workspace/shell/right-panel/ViewerHeaderButton";
import { usePromptAttachmentPreviewActions } from "#product/hooks/chat/workflows/use-prompt-attachment-preview-actions";
import type { PromptAttachmentDescriptor } from "@proliferate/product-domain/chats/composer/prompt-attachment-rules";
import {
  viewerTargetKey,
} from "#product/lib/domain/workspaces/viewer/viewer-target";
import { focusChatInput } from "#product/lib/domain/focus-zone";
import { useWorkspaceViewerTabsStore } from "#product/stores/editor/workspace-viewer-tabs-store";

const PLAYGROUND_ATTACHMENT_SESSION_ID = "playground-attachment-session";
const PLAYGROUND_IMAGE_ID = "playground-attachment-image";
const PLAYGROUND_TEXT_ID = "playground-attachment-text";
const IMAGE_DATA_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fb7185"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs>
    <rect width="640" height="420" rx="32" fill="#171717"/>
    <rect x="28" y="28" width="584" height="364" rx="24" fill="url(#g)" opacity=".92"/>
    <circle cx="188" cy="180" r="76" fill="#fff" opacity=".18"/>
    <path d="M92 330l118-112 80 70 66-58 192 100H92z" fill="#fff" opacity=".72"/>
    <text x="52" y="78" fill="#fff" font-family="system-ui" font-size="28" font-weight="700">Attachment preview</text>
  </svg>
`)}`;
const TEXT_DATA_URL = `data:text/plain;charset=utf-8,${encodeURIComponent(
  "Draft attachment preview\n\nThis text stays in memory and never becomes a workspace file.\n",
)}`;

const INITIAL_DRAFT_ATTACHMENTS: PromptAttachmentDescriptor[] = [
  {
    id: "draft-image",
    name: "attachment-preview.png",
    mimeType: "image/png",
    size: 245_760,
    kind: "image",
    source: "upload",
    objectUrl: IMAGE_DATA_URL,
  },
  {
    id: "draft-paste",
    name: "paste-2026-07-18.txt",
    mimeType: "text/plain",
    size: 3_824,
    kind: "text_resource",
    source: "paste",
    objectUrl: TEXT_DATA_URL,
  },
  {
    id: "draft-file",
    name: "interaction-notes.md",
    mimeType: "text/markdown",
    size: 8_192,
    kind: "text_resource",
    source: "upload",
    objectUrl: TEXT_DATA_URL,
  },
];

const SENT_ATTACHMENT_PARTS: ContentPart[] = [
  {
    type: "text",
    text: "Compare the screenshot and interaction notes before updating the composer.",
  },
  {
    type: "image",
    attachmentId: PLAYGROUND_IMAGE_ID,
    name: "attachment-preview.png",
    mimeType: "image/png",
    size: 245_760,
    source: "upload",
  },
  {
    type: "resource",
    attachmentId: PLAYGROUND_TEXT_ID,
    uri: "file://interaction-notes.md",
    name: "interaction-notes.md",
    mimeType: "text/markdown",
    size: 8_192,
    source: "upload",
  },
];

export function PlaygroundAttachmentComposerSurface({
  controlRow,
}: {
  controlRow: ReactNode;
}) {
  const [attachments, setAttachments] = useState(INITIAL_DRAFT_ATTACHMENTS);
  const { closeDraftAttachmentPreview } = usePromptAttachmentPreviewActions();
  return (
    <ChatComposerSurface overflowMode="clip">
      <form className="relative flex flex-col" data-focus-zone="chat">
        <DraftAttachmentPreviewList
          attachments={attachments}
          onRemove={(id) => {
            closeDraftAttachmentPreview(id);
            setAttachments((current) => (
              current.filter((attachment) => attachment.id !== id)
            ));
          }}
        />
        <ComposerTextareaFrame topInset="none">
          <ComposerTextarea
            data-chat-composer-editor
            data-telemetry-mask
            rows={2}
            value="Use these references to tighten the attachment interaction."
            spellCheck={false}
            readOnly
          />
        </ComposerTextareaFrame>
        {controlRow}
      </form>
    </ChatComposerSurface>
  );
}

export function PlaygroundAttachmentTranscript() {
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    queryClient.setQueryData(
      ["prompt-attachment", PLAYGROUND_ATTACHMENT_SESSION_ID, PLAYGROUND_IMAGE_ID],
      svgDataUrlBlob(IMAGE_DATA_URL),
    );
    queryClient.setQueryData(
      ["prompt-attachment", PLAYGROUND_ATTACHMENT_SESSION_ID, PLAYGROUND_TEXT_ID],
      new Blob([
        "Submitted attachment preview\n\nThis content is fetched through the session attachment cache.\n",
      ], { type: "text/markdown" }),
    );
    setReady(true);
    return () => {
      queryClient.removeQueries({
        queryKey: ["prompt-attachment", PLAYGROUND_ATTACHMENT_SESSION_ID],
      });
    };
  }, [queryClient]);

  if (!ready) {
    return null;
  }
  return (
    <div className="space-y-3">
      <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Submitted attachments
      </div>
      <UserMessage
        sessionId={PLAYGROUND_ATTACHMENT_SESSION_ID}
        content="Compare the screenshot and interaction notes before updating the composer."
        contentParts={SENT_ATTACHMENT_PARTS}
      />
    </div>
  );
}

export function PlaygroundAttachmentPreviewAside() {
  const openTargets = useWorkspaceViewerTabsStore((state) => state.openTargets);
  const activeTargetKey = useWorkspaceViewerTabsStore((state) => state.activeTargetKey);
  const closeTarget = useWorkspaceViewerTabsStore((state) => state.closeTarget);
  const setActiveTarget = useWorkspaceViewerTabsStore((state) => state.setActiveTarget);
  const target = useMemo(() => openTargets.find((candidate) => (
    viewerTargetKey(candidate) === activeTargetKey
    && candidate.kind === "promptAttachment"
  )), [activeTargetKey, openTargets]);

  useEffect(() => () => {
    const state = useWorkspaceViewerTabsStore.getState();
    state.openTargets.forEach((candidate) => {
      if (candidate.kind === "promptAttachment") {
        state.closeTarget(viewerTargetKey(candidate));
      }
    });
  }, []);

  return (
    <aside className="flex w-[26rem] shrink-0 flex-col border-l border-sidebar-border bg-sidebar-background">
      {target?.kind === "promptAttachment" ? (
        <>
          <div className="right-panel-tab-system flex h-10 shrink-0 items-stretch border-b border-sidebar-border">
            <ViewerHeaderButton
              target={target}
              isActive
              isDirty={false}
              isDiff={false}
              isDragging={false}
              shouldSuppressClick={() => false}
              onSelect={() => setActiveTarget(viewerTargetKey(target))}
              onClose={() => {
                closeTarget(viewerTargetKey(target));
                focusChatInput();
              }}
            />
          </div>
          <div className="min-h-0 flex-1">
            <PromptAttachmentViewer target={target} />
          </div>
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
          Select a draft or submitted attachment to preview it here.
        </div>
      )}
    </aside>
  );
}

function svgDataUrlBlob(dataUrl: string): Blob {
  const encoded = dataUrl.split(",", 2)[1] ?? "";
  return new Blob([decodeURIComponent(encoded)], { type: "image/svg+xml" });
}
