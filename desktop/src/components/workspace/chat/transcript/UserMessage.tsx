import { useLayoutEffect, useRef, useState } from "react";
import type { ContentPart } from "@anyharness/sdk";
import { Button } from "@/components/ui/Button";
import { CopyMessageButton } from "./CopyMessageButton";
import { PromptContentRenderer } from "@/components/workspace/chat/content/PromptContentRenderer";

export interface UserMessageProps {
  sessionId: string | null;
  content: string;
  contentParts?: ContentPart[];
  showCopyButton?: boolean;
}

export function UserMessage({
  sessionId,
  content,
  contentParts = [],
  showCopyButton = false,
}: UserMessageProps) {
  const [expanded, setExpanded] = useState(false);
  const [needsToggle, setNeedsToggle] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    setNeedsToggle(el.scrollHeight > el.clientHeight);
  }, [content, contentParts]);

  return (
    <div
      data-chat-selection-unit
      className={showCopyButton ? "group/msg flex justify-end" : "flex justify-end"}
    >
      <div className="flex w-full flex-col items-end justify-end gap-1">
        <div className="max-w-[77%] break-words rounded-2xl bg-foreground/5 px-3 py-2 text-foreground">
          <div
            ref={textRef}
            className={`break-words select-text${
              !expanded ? " line-clamp-5" : ""
            }`}
          >
            <PromptContentRenderer
              sessionId={sessionId}
              parts={contentParts}
              fallbackText={content}
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
        {showCopyButton && content && (
          <div className="pr-1 pt-0.5">
            <CopyMessageButton
              content={content}
              visibilityClassName="opacity-0 group-hover/msg:opacity-100"
            />
          </div>
        )}
      </div>
    </div>
  );
}
