import { CommandWindow } from "#product/primitives/icons/workspace";
import { AutoHideScrollArea } from "#product/primitives/patterns/AutoHideScrollArea";
import { TOOL_CALL_BODY_MAX_HEIGHT_CLASS } from "#product/domain/chats/tools/tool-call-layout";
import { ToolActionDetailsPanel } from "#product/components/workspace/chat/tool-calls/ToolActionDetailsPanel";
import { ToolActionRow } from "#product/components/workspace/chat/tool-calls/ToolActionRow";

interface BashCommandCallProps {
  command: string;
  description?: string;
  output?: string;
  status: "running" | "completed" | "failed";
  duration?: string;
  /**
   * Set when this command was backgrounded and its `ActivityProcess.id`
   * correlated from the tool result text (bgwork r8). Clicking the row then
   * opens the Background work pane's terminal detail instead of toggling the
   * inline output disclosure.
   */
  onOpenBackgroundTerminal?: () => void;
}

export function BashCommandCall({
  command,
  description,
  output,
  status,
  duration,
  onOpenBackgroundTerminal,
}: BashCommandCallProps) {
  const label = description
    ?? (status === "failed" ? "Command" : "Running command");

  return (
    <ToolActionRow
      icon={<CommandWindow />}
      label={label}
      hint={command}
      status={status}
      duration={duration}
      onOpen={onOpenBackgroundTerminal}
    >
      {output && (
        <ToolActionDetailsPanel>
          <AutoHideScrollArea
            viewportClassName={TOOL_CALL_BODY_MAX_HEIGHT_CLASS}
            contentClassName="px-3 py-2"
          >
            <pre className="m-0 whitespace-pre-wrap font-mono text-readable-code text-foreground">
              <code>{output}</code>
            </pre>
          </AutoHideScrollArea>
        </ToolActionDetailsPanel>
      )}
    </ToolActionRow>
  );
}
