import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ChevronRight } from "@/components/ui/icons";

export interface SystemMessageProps {
  content: string;
}

export function SystemMessage({ content }: SystemMessageProps) {
  const [systemExpanded, setSystemExpanded] = useState(false);

  return (
    <div className="py-1.5">
      <Button
        type="button"
        variant="ghost"
        data-chat-transcript-ignore
        onClick={() => setSystemExpanded(!systemExpanded)}
        className="flex h-auto w-full justify-start gap-2 rounded-none bg-transparent px-3 py-1.5 text-left font-sans text-xs text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground"
      >
        <ChevronRight
          className={`size-3 shrink-0 transition-transform duration-150 ${
            systemExpanded ? "rotate-90" : ""
          }`}
        />
        <span>System message</span>
      </Button>
      {systemExpanded && (
        <div
          className="mt-1 rounded-md border border-border bg-card px-3.5 py-2.5 font-sans text-[12px] leading-[1.65] tracking-[-0.01em] whitespace-pre-wrap text-muted-foreground select-text"
        >
          {content}
        </div>
      )}
    </div>
  );
}
