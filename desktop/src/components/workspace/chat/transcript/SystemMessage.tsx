import { useState } from "react";
import { ChevronRight } from "@/components/ui/icons";

export interface SystemMessageProps {
  content: string;
}

export function SystemMessage({ content }: SystemMessageProps) {
  const [systemExpanded, setSystemExpanded] = useState(false);

  return (
    <div data-chat-selection-unit className="py-1.5">
      <button
        type="button"
        onClick={() => setSystemExpanded(!systemExpanded)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-sans text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight
          className={`size-3 shrink-0 transition-transform duration-150 ${
            systemExpanded ? "rotate-90" : ""
          }`}
        />
        <span>System message</span>
      </button>
      {systemExpanded && (
        <div
          className="mt-1 rounded-md border border-border bg-card px-3.5 py-2.5 font-sans text-[12px] leading-[1.65] tracking-[-0.01em] whitespace-pre-wrap text-muted-foreground"
        >
          {content}
        </div>
      )}
    </div>
  );
}
