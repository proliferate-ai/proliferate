import { Brain } from "@/components/ui/icons";
import { TOOL_CALL_BODY_MAX_HEIGHT_CLASS } from "@/lib/domain/chat/tool-call-layout";
import { ToolActionDetailsPanel } from "./ToolActionDetailsPanel";
import { ToolActionRow } from "./ToolActionRow";

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
    <ToolActionRow
      icon={<Brain />}
      label={<span className="font-[460] text-foreground/90">Thinking</span>}
      hint={deriveHint(content)}
      status="completed"
      defaultExpanded={false}
      expandable={!!content}
    >
      {content ? (
        <ToolActionDetailsPanel>
          <div
            className={`overflow-y-auto select-text whitespace-pre-wrap break-words px-3 py-2 font-mono text-[length:var(--readable-code-font-size)] leading-[var(--readable-code-line-height)] text-foreground ${TOOL_CALL_BODY_MAX_HEIGHT_CLASS}`}
          >
            {content}
          </div>
        </ToolActionDetailsPanel>
      ) : null}
    </ToolActionRow>
  );
}
