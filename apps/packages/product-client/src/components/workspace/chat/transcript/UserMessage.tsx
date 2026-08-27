import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { ContentPart } from "@anyharness/sdk";
import { ChevronDown } from "#product/primitives/icons/core";
import { Button } from "#product/primitives/Button";
import { CarryOutPlanRow } from "#product/components/workspace/chat/transcript/CarryOutPlanRow";
import { CopyMessageButton } from "#product/components/workspace/chat/transcript/CopyMessageButton";
import { PromptContentRenderer } from "#product/components/workspace/chat/content/PromptContentRenderer";
import { isPlanImplementationPromptMessage } from "#product/lib/domain/plans/implementation-prompt";
import {
  normalizeContentParts,
  type PromptDisplayPlanPart,
} from "#product/domain/chats/composer/prompt-display-parts";
import { usePromptAttachmentPreviewActions } from "#product/hooks/chat/workflows/use-prompt-attachment-preview-actions";

export interface UserMessageProps {
  sessionId: string | null;
  content: string;
  contentParts?: ContentPart[];
  showCopyButton?: boolean;
  timestampLabel?: string | null;
  footer?: ReactNode;
}

export function UserMessage({
  sessionId,
  content,
  contentParts = [],
  showCopyButton = false,
  timestampLabel = null,
  footer,
}: UserMessageProps) {
  const [expanded, setExpanded] = useState(false);
  const [needsToggle, setNeedsToggle] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);
  const displayParts = normalizeContentParts(contentParts, content);
  // The canned 'Run here' carry-out prompt renders as a compact system-style
  // row + plan chip — a full bubble would repeat the whole plan again.
  const carryOutPlanPart = isPlanImplementationPromptMessage(content, contentParts)
    ? displayParts.find(
      (part): part is PromptDisplayPlanPart => part.type === "plan_reference",
    ) ?? null
    : null;
  const hasAttachments = displayParts.some((part) => part.type !== "text");
  const hasPreviewableAttachments = displayParts.some((part) => (
    part.type === "image" || part.type === "file"
  ));
  const hasTextPart = displayParts.some((part) => (
    part.type === "text" && part.text.trim().length > 0
  ));
  const shouldRenderTextBubble = hasTextPart || (!hasAttachments && content.trim().length > 0);
  const textParts = hasTextPart ? contentParts : [];

  useLayoutEffect(() => {
    if (!shouldRenderTextBubble) {
      setNeedsToggle(false);
      return;
    }
    const el = textRef.current;
    if (!el) return;
    setNeedsToggle(el.scrollHeight > el.clientHeight);
  }, [content, contentParts, shouldRenderTextBubble]);

  if (carryOutPlanPart) {
    return <CarryOutPlanRow plan={carryOutPlanPart} />;
  }

  return (
    <div
      className={showCopyButton ? "group/msg flex justify-end" : "flex justify-end"}
      data-chat-user-message
    >
      <div className="flex w-full flex-col items-end justify-end gap-1">
        {hasAttachments && (
          <div className="w-full max-w-xl self-end lg:max-w-3xl" data-telemetry-mask>
            <UserMessageAttachmentContent
              sessionId={sessionId}
              parts={contentParts}
              previewEnabled={hasPreviewableAttachments}
            />
          </div>
        )}
        {shouldRenderTextBubble && (
          <div
            /*
             * The border color and the elevation come from
             * `.chat-user-message-bubble` in the design CSS, not from utilities:
             * a generated `shadow-*` utility inlines one mode's token value at
             * build time, which would bake in dark's `none` and leave light with
             * no lift. The design CSS emits the var and lets the cascade pick.
             */
            className="chat-user-message-bubble max-w-[77%] break-words rounded-2xl border px-3 py-2 text-foreground"
            data-telemetry-mask
          >
            <div
              ref={textRef}
              className={`[--prose-text-size:var(--text-message)] [--prose-text-line-height:var(--text-message--line-height)] break-words select-text${
                !expanded ? " line-clamp-[20]" : ""
              }`}
            >
              <PromptContentRenderer
                sessionId={sessionId}
                parts={textParts}
                fallbackText={content}
                includeAttachments={false}
              />
            </div>
            {needsToggle && (
              /*
               * Unstyled Button, not the ghost variant: the toggle must never
               * grow its own background (the ghost hover wash reads as a pill
               * inside the bubble) and must sit flush with the message text's
               * left edge, so it carries no horizontal padding of its own —
               * the bubble's px-3 is the shared left margin.
               */
              <Button
                type="button"
                variant="unstyled"
                size="unstyled"
                data-chat-transcript-ignore
                onClick={() => setExpanded((v) => !v)}
                className="mt-1.5 flex items-center gap-1 text-chat text-muted-foreground hover:text-foreground"
              >
                {expanded ? "Show less" : "Show more"}
                {/*
                 * Always rendered (not opacity/hover-gated) so the chevron
                 * occupies stable space at all times — an opacity-only fade
                 * still reserves the slot, but a hover-mounted element does
                 * not, which is what made the label visibly shift right on
                 * hover before. Only the rotate on expand/collapse and the
                 * inherited hover color change; position never moves.
                 */}
                <ChevronDown
                  aria-hidden="true"
                  className={`icon-paired shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
                />
              </Button>
            )}
          </div>
        )}
        {footer ? (
          <div className="max-w-[77%] self-end">
            {footer}
          </div>
        ) : null}
        {showCopyButton && content && shouldRenderTextBubble && (
          <div className="pt-0.5">
            <CopyMessageButton
              content={content}
              timestampLabel={timestampLabel}
              visibilityClassName="opacity-0 group-hover/msg:opacity-100"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function UserMessageAttachmentContent({
  sessionId,
  parts,
  previewEnabled,
}: {
  sessionId: string | null;
  parts: ContentPart[];
  previewEnabled: boolean;
}) {
  if (previewEnabled) {
    return <PreviewConnectedUserMessageAttachments sessionId={sessionId} parts={parts} />;
  }
  return <UserMessageAttachments sessionId={sessionId} parts={parts} />;
}

function PreviewConnectedUserMessageAttachments({
  sessionId,
  parts,
}: {
  sessionId: string | null;
  parts: ContentPart[];
}) {
  const { openAttachmentPreview } = usePromptAttachmentPreviewActions();
  return (
    <PromptContentRenderer
      sessionId={sessionId}
      parts={parts}
      fallbackText=""
      variant="transcript"
      includeText={false}
      layout="auto"
      onOpenAttachment={(part) => openAttachmentPreview({
        part,
        origin: "session",
        sessionId,
      })}
    />
  );
}

function UserMessageAttachments({
  sessionId,
  parts,
}: {
  sessionId: string | null;
  parts: ContentPart[];
}) {
  return (
    <PromptContentRenderer
      sessionId={sessionId}
      parts={parts}
      fallbackText=""
      variant="transcript"
      includeText={false}
      layout="auto"
    />
  );
}
