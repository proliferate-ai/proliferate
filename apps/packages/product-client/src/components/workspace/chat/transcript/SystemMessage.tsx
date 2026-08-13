import { useState } from "react";
import { Button } from "#product/primitives/Button";
import { Settings } from "#product/primitives/icons/core";
import { Card } from "#product/primitives/patterns/Card";

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
        className="flex h-auto w-full justify-start gap-2 rounded-none bg-transparent px-3 py-1.5 text-left font-sans text-chat text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground"
      >
        <Settings
          aria-hidden="true"
          className={`icon-compact shrink-0 transition-colors ${
            systemExpanded ? "text-foreground/70" : "text-faint"
          }`}
        />
        <span>System message</span>
      </Button>
      {systemExpanded && (
        <Card surface="opaque" className="mt-1">
          {/*
            tracking-[-0.01em] is a recorded cause (DESIGN_SYSTEM.md
            § UI-conformance review, check 4): the body is pre-formatted system
            output, and the slight negative tracking keeps long unwrapped lines
            inside the transcript column. Optical, not a scale step.
          */}
          <div className="px-3.5 py-2.5 font-sans text-chat tracking-[-0.01em] whitespace-pre-wrap text-muted-foreground select-text">
            {content}
          </div>
        </Card>
      )}
    </div>
  );
}
