import { ThinkingGlyph } from "#product/primitives/icons/product";
import { AutoHideScrollArea } from "#product/primitives/patterns/AutoHideScrollArea";
import { TOOL_CALL_BODY_MAX_HEIGHT_CLASS } from "#product/domain/chats/tools/tool-call-layout";
import { ToolActionDetailsPanel } from "#product/components/workspace/chat/tool-calls/ToolActionDetailsPanel";
import { ToolActionRow } from "#product/components/workspace/chat/tool-calls/ToolActionRow";

interface ReasoningBlockProps {
  content?: string;
}

function deriveHint(content?: string): string | undefined {
  if (!content) return undefined;
  const firstLine = content.trimStart().split("\n")[0]!.trim();
  if (!firstLine) return undefined;
  return firstLine;
}

export function ReasoningBlock({ content }: ReasoningBlockProps) {
  return (
    <ToolActionRow
      icon={<ThinkingGlyph />}
      label="Thought"
      hint={deriveHint(content)}
      status="completed"
      defaultExpanded={false}
      expandable={!!content}
    >
      {content ? (
        <ToolActionDetailsPanel>
          <AutoHideScrollArea
            viewportClassName={TOOL_CALL_BODY_MAX_HEIGHT_CLASS}
            contentClassName="select-text whitespace-pre-wrap break-words px-3 py-2 text-chat text-foreground"
          >
            {content}
          </AutoHideScrollArea>
        </ToolActionDetailsPanel>
      ) : null}
    </ToolActionRow>
  );
}
