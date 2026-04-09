import { useLayoutEffect, useRef, useState } from "react";
import { CopyMessageButton } from "./CopyMessageButton";

export interface UserMessageProps {
  content: string;
  showCopyButton?: boolean;
}

export function UserMessage({ content, showCopyButton = false }: UserMessageProps) {
  const [expanded, setExpanded] = useState(false);
  const [needsToggle, setNeedsToggle] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    setNeedsToggle(el.scrollHeight > el.clientHeight);
  }, [content]);

  return (
    <div
      data-chat-selection-unit
      className={showCopyButton ? "group/msg flex justify-end" : "flex justify-end"}
    >
      <div className="flex w-full flex-col items-end justify-end gap-1">
        <div className="max-w-[77%] break-words rounded-2xl bg-foreground/5 px-3 py-2 text-foreground">
          <div
            ref={textRef}
            className={`text-chat break-words whitespace-pre-wrap select-text${
              !expanded ? " line-clamp-5" : ""
            }`}
          >
            {content}
          </div>
          {needsToggle && (
            <div className="mt-1 flex justify-end">
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                {expanded ? "Show less" : "Show more"}
              </button>
            </div>
          )}
        </div>
        {showCopyButton && content && (
          <div className="pr-1 pt-0.5">
            <CopyMessageButton content={content} />
          </div>
        )}
      </div>
    </div>
  );
}
