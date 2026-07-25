import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ChevronDown } from "@proliferate/ui/icons";
import { CopyMessageButton } from "./CopyMessageButton";
import { MarkdownBody } from "./MarkdownBody";
import { userMessageStatusLabel } from "./CloudChatTranscriptPresentation";

const OVERFLOW_TOLERANCE_PX = 2;

export function CloudChatUserMessage({
  content,
  status = null,
}: {
  content: string;
  status?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [needsToggle, setNeedsToggle] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);
  const hasContent = content.trim().length > 0;
  const visibleStatus = userMessageStatusLabel(status);

  const measureOverflow = useCallback(() => {
    if (expanded) {
      return;
    }
    const el = textRef.current;
    if (!el) return;
    setNeedsToggle(el.scrollHeight - el.clientHeight > OVERFLOW_TOLERANCE_PX);
  }, [expanded]);

  useLayoutEffect(() => {
    if (!hasContent) {
      setNeedsToggle(false);
      return;
    }
    measureOverflow();
  }, [content, hasContent, measureOverflow]);

  useLayoutEffect(() => {
    if (!hasContent) return;
    const el = textRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // Wrapping (and therefore overflow) changes with element width, e.g.
    // when the sidebar or window is resized.
    const observer = new ResizeObserver(measureOverflow);
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasContent, measureOverflow]);

  return (
    <article className="group/msg flex justify-end" data-chat-user-message>
      <div className="flex w-full flex-col items-end justify-end gap-1">
        {hasContent ? (
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
                content={content}
                styleVariant="transcript"
                className="whitespace-pre-wrap [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_li+li]:!mt-0 [&_li>ol]:!mt-0 [&_li>p+p]:!mt-0 [&_li>ul]:!mt-0 [&_ol]:!m-0 [&_ol]:!pl-6 [&_p]:!m-0 [&_p+p]:!mt-5 [&_ul]:!m-0 [&_ul]:!pl-6"
              />
            </div>
            {needsToggle && !expanded ? (
              <span aria-hidden="true" className="block">…</span>
            ) : null}
            {needsToggle ? (
              <div className="mt-1.5 flex justify-start">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-chat-transcript-ignore
                  aria-expanded={expanded}
                  onClick={() => setExpanded((value) => !value)}
                  className="h-auto gap-1 px-0 py-0 text-[length:var(--text-chat)] font-normal leading-[var(--text-chat--line-height)] text-muted-foreground hover:bg-transparent hover:text-foreground"
                >
                  <span>{expanded ? "Show less" : "Show more"}</span>
                  <ChevronDown
                    aria-hidden="true"
                    className={`size-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
                  />
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
        {visibleStatus ? (
          <div className="inline-flex items-center gap-1 pr-1 text-chat leading-[var(--text-chat--line-height)] text-muted-foreground">
            {visibleStatus}
          </div>
        ) : null}
        {hasContent ? (
          <div className="mx-1">
            <CopyMessageButton
              content={content}
              timestampLabel={null}
              visibilityClassName="opacity-0 group-hover/msg:opacity-100 group-focus-within/msg:opacity-100"
            />
          </div>
        ) : null}
      </div>
    </article>
  );
}
