import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ContentPart } from "@anyharness/sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import { ChevronDown } from "@proliferate/ui/icons";
import { MarkdownBody } from "@proliferate/product-ui/chat/transcript/MarkdownBody";
import { CarryOutPlanRow } from "./CarryOutPlanRow";
import { CopyMessageButton } from "./CopyMessageButton";
import { PromptContentRenderer } from "@/components/workspace/chat/content/PromptContentRenderer";
import { isPlanImplementationPromptMessage } from "@/lib/domain/plans/implementation-prompt";
import {
  normalizeContentParts,
  type PromptDisplayPlanPart,
} from "@proliferate/product-domain/chats/composer/prompt-display-parts";
import {
  renderTranscriptCodeBlock,
  renderTranscriptInlineCode,
  renderTranscriptLink,
} from "./transcript-markdown";

export interface UserMessageProps {
  sessionId: string | null;
  content: string;
  contentParts?: ContentPart[];
  showCopyButton?: boolean;
  timestampLabel?: string | null;
  footer?: ReactNode;
}

const OVERFLOW_TOLERANCE_PX = 2;

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
  const hasTextPart = displayParts.some((part) => (
    part.type === "text" && part.text.trim().length > 0
  ));
  const shouldRenderTextBubble = hasTextPart || (!hasAttachments && content.trim().length > 0);
  const messageText = displayParts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n\n") || content;

  const measureOverflow = useCallback(() => {
    if (expanded) {
      return;
    }
    const element = textRef.current;
    if (!element) {
      return;
    }
    setNeedsToggle(
      element.scrollHeight - element.clientHeight > OVERFLOW_TOLERANCE_PX,
    );
  }, [expanded]);

  useLayoutEffect(() => {
    if (!shouldRenderTextBubble) {
      setNeedsToggle(false);
      return;
    }
    measureOverflow();
  }, [content, contentParts, measureOverflow, shouldRenderTextBubble]);

  useLayoutEffect(() => {
    if (!shouldRenderTextBubble) {
      return;
    }
    const element = textRef.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measureOverflow);
    observer.observe(element);
    return () => observer.disconnect();
  }, [measureOverflow, shouldRenderTextBubble]);

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
          <div
            tabIndex={0}
            className="chat-user-message-bubble min-w-0 max-w-[77%] overflow-hidden break-words rounded-2xl bg-foreground/5 px-3 py-2 text-left text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-telemetry-mask
          >
            <div
              ref={textRef}
              className="w-full min-w-0 overflow-hidden [--prose-text-size:var(--text-message)] [--prose-text-line-height:var(--text-message--line-height)]"
              style={expanded ? undefined : { maxHeight: "19lh" }}
            >
              <MarkdownBody
                content={messageText}
                styleVariant="transcript"
                renderLink={renderTranscriptLink}
                renderInlineCode={renderTranscriptInlineCode}
                renderCodeBlock={renderTranscriptCodeBlock}
                className="whitespace-pre-wrap [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_li+li]:!mt-0 [&_li>ol]:!mt-0 [&_li>p+p]:!mt-0 [&_li>ul]:!mt-0 [&_ol]:!m-0 [&_ol]:!pl-6 [&_p]:!m-0 [&_p+p]:!mt-5 [&_ul]:!m-0 [&_ul]:!pl-6"
              />
            </div>
            {needsToggle && !expanded && (
              <span aria-hidden="true" className="block">…</span>
            )}
            {needsToggle && (
              <div className="mt-1.5 flex justify-start">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-chat-transcript-ignore
                  aria-expanded={expanded}
                  onClick={() => setExpanded((v) => !v)}
                  className="h-auto gap-1 px-0 py-0 text-[length:var(--text-chat)] font-normal leading-[var(--text-chat--line-height)] text-muted-foreground hover:bg-transparent hover:text-foreground"
                >
                  <span>{expanded ? "Show less" : "Show more"}</span>
                  <ChevronDown
                    aria-hidden="true"
                    className={`size-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
                  />
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
          <div className="mx-1">
            <CopyMessageButton
              content={content}
              timestampLabel={timestampLabel}
              visibilityClassName="opacity-0 group-hover/msg:opacity-100 group-focus-within/msg:opacity-100"
            />
          </div>
        )}
      </div>
    </div>
  );
}
