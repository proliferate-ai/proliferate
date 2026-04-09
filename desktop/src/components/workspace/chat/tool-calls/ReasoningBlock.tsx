import { Brain } from "@/components/ui/icons";
import { ToolCallBlock, TOOL_CALL_BODY_MAX_HEIGHT_CLASS } from "./ToolCallBlock";

interface ReasoningBlockProps {
  content?: string;
}

function deriveHint(content?: string): string | undefined {
  if (!content) return undefined;
  const firstLine = content.trimStart().split("\n")[0].trim();
  if (!firstLine) return undefined;
  return firstLine;
}

export function ReasoningBlock({ content }: ReasoningBlockProps) {
  return (
    <ToolCallBlock
      icon={<Brain />}
      name={<span className="font-[460] text-foreground/90">Thinking</span>}
      hint={deriveHint(content)}
      status="completed"
      defaultExpanded={false}
      expandable={!!content}
    >
      {content ? (
        <div
          data-chat-selection-unit
          className={`overflow-y-auto select-text whitespace-pre-wrap break-words font-mono text-xs ${TOOL_CALL_BODY_MAX_HEIGHT_CLASS}`}
        >
          {content}
        </div>
      ) : null}
    </ToolCallBlock>
  );
}
