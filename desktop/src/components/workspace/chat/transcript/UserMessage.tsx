import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { ContentPart } from "@anyharness/sdk";
import { Button } from "@/components/ui/Button";
import { CopyMessageButton } from "./CopyMessageButton";
import { PromptContentRenderer } from "@/components/workspace/chat/content/PromptContentRenderer";
import { normalizeContentParts } from "@/lib/domain/chat/prompt-content";

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
  const hasAttachments = displayParts.some((part) => part.type !== "text");
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

  return (
    <div
      data-chat-selection-unit
      className={showCopyButton ? "group/msg flex justify-end" : "flex justify-end"}
    >
      <div className="flex w-full flex-col items-end justify-end gap-1">
        {hasAttachments && (
          <div className="w-full max-w-xl self-end lg:max-w-3xl">
            <PromptContentRenderer
              sessionId={sessionId}
              parts={contentParts}
              fallbackText=""
              variant="transcript"
              includeText={false}
              layout="auto"
            />
          </div>
        )}
        {shouldRenderTextBubble && (
          <div className="max-w-[77%] break-words rounded-2xl bg-foreground/5 px-3 py-2 text-foreground">
            <div
              ref={textRef}
              className={`break-words select-text${
                !expanded ? " line-clamp-5" : ""
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
              <div className="mt-1 flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setExpanded((v) => !v)}
                  className="h-auto px-1 py-0 text-[11px] text-muted-foreground hover:bg-transparent hover:text-foreground"
                >
                  {expanded ? "Show less" : "Show more"}
                </Button>
              </div>
            )}
          </div>
        )}
        {footer ? (
          <div className="max-w-[77%] self-end">
            {footer}
          </div>
        ) : null}
        {showCopyButton && content && shouldRenderTextBubble && (
          <div className="pr-1 pt-0.5">
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
