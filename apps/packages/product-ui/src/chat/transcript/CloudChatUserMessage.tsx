import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { CopyMessageButton } from "./CopyMessageButton";
import { userMessageStatusLabel } from "./CloudChatTranscriptPresentation";

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

  // `line-clamp-5` reports a 1-2px scrollHeight/clientHeight delta even when
  // the text fits in 5 lines, due to sub-pixel line-height rounding. A small
  // tolerance avoids treating that rounding noise as real overflow, while
  // still catching genuine 6+-line messages (which overflow by a full line).
  const OVERFLOW_TOLERANCE_PX = 2;

  const measureOverflow = useCallback(() => {
    const el = textRef.current;
    if (!el) return;
    setNeedsToggle(el.scrollHeight - el.clientHeight > OVERFLOW_TOLERANCE_PX);
  }, []);

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
    const observer = new ResizeObserver(() => measureOverflow());
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasContent, measureOverflow]);

  return (
    <article className="group/msg flex justify-end" data-chat-user-message>
      <div className="flex w-full flex-col items-end justify-end gap-1">
        {hasContent ? (
          <div
            className="max-w-[77%] break-words rounded-2xl bg-foreground/5 px-3 py-2 text-foreground"
            data-telemetry-mask
          >
            <div
              ref={textRef}
              className={`break-words select-text text-[length:var(--text-message)] leading-[var(--text-message--line-height)]${
                !expanded ? " line-clamp-5" : ""
              }`}
            >
              {content}
            </div>
            {needsToggle ? (
              <div className="mt-1 flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-chat-transcript-ignore
                  onClick={() => setExpanded((value) => !value)}
                  className="h-auto px-1 py-0 text-base text-muted-foreground hover:bg-transparent hover:text-foreground"
                >
                  {expanded ? "Show less" : "Show more"}
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
          <div className="pr-1 pt-0.5">
            <CopyMessageButton
              content={content}
              timestampLabel={null}
              visibilityClassName="opacity-0 group-hover/msg:opacity-100"
            />
          </div>
        ) : null}
      </div>
    </article>
  );
}
