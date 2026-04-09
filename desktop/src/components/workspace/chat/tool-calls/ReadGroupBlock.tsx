import { useState, type ReactNode } from "react";
import { FileText } from "@/components/ui/icons";
import { useStickToBottom } from "@/hooks/ui/use-stick-to-bottom";
import {
  formatReadGroupHeader,
  type ReadGroup,
} from "@/lib/domain/chat/transcript-presentation";
import { ToolCallBlock } from "./ToolCallBlock";

interface ReadGroupBlockProps {
  group: ReadGroup;
  /** Pre-rendered member rows. The caller computes these to avoid coupling
   *  this component to the transcript renderer that lives in MessageList. */
  children: ReactNode;
}

export function ReadGroupBlock({ group, children }: ReadGroupBlockProps) {
  const isRunning = group.status === "running";
  const [userExpanded, setUserExpanded] = useState(false);
  // While running, force expanded so the live tailing viewport is visible.
  // On the running → completed transition, isRunning flips false and
  // userExpanded is still its initial false, so the viewport auto-collapses.
  // After completion, the user controls expansion normally via the click handler.
  const expanded = isRunning || userExpanded;
  const tailRef = useStickToBottom<HTMLDivElement>();

  return (
    <div className="flex justify-start relative">
      <div className="flex flex-col w-full max-w-xl lg:max-w-3xl space-y-1 break-words">
        <ToolCallBlock
          icon={<FileText className="size-3 text-faint" />}
          name={
            <span className="font-[460] text-foreground/90">
              {formatReadGroupHeader(group)}
            </span>
          }
          status={isRunning ? "running" : "completed"}
          expanded={expanded}
          onExpandedChange={(next) => {
            // Live viewport shouldn't be dismissable while reads are streaming.
            if (!isRunning) setUserExpanded(next);
          }}
        >
          {isRunning ? (
            <div ref={tailRef} className="max-h-44 overflow-y-auto">
              <div className="space-y-1.5">{children}</div>
            </div>
          ) : (
            <div className="max-h-44 overflow-y-auto">
              <div className="space-y-1.5">{children}</div>
            </div>
          )}
        </ToolCallBlock>
      </div>
    </div>
  );
}
