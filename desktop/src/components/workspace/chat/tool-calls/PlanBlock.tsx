import { MarkdownRenderer } from "@/components/ui/content/MarkdownRenderer";
import { PlanningIcon } from "@/components/ui/icons";
import { ToolCallBlock, TOOL_CALL_BODY_MAX_HEIGHT_CLASS } from "./ToolCallBlock";

interface PlanBlockProps {
  title: string;
  content: string;
}

export function PlanBlock({ title, content }: PlanBlockProps) {
  return (
    <ToolCallBlock
      icon={<PlanningIcon />}
      name={title}
      status="completed"
      defaultExpanded={false}
    >
      <div
        data-chat-selection-unit
        className={`overflow-y-auto select-text text-sm text-foreground ${TOOL_CALL_BODY_MAX_HEIGHT_CLASS}`}
      >
        <MarkdownRenderer content={content} />
      </div>
    </ToolCallBlock>
  );
}
