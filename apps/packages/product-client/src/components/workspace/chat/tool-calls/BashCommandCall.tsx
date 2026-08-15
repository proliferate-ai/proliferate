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
}

export function BashCommandCall({
  command,
  description,
  output,
  status,
  duration,
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
