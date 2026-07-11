import { CommandWindow } from "@proliferate/ui/icons";
import { TOOL_CALL_BODY_MAX_HEIGHT_CLASS } from "@proliferate/product-domain/chats/tools/tool-call-layout";
import { ToolActionDetailsPanel } from "./ToolActionDetailsPanel";
import { ToolActionRow } from "./ToolActionRow";

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
          <div
            className={`w-full overflow-y-auto px-3 py-2 ${TOOL_CALL_BODY_MAX_HEIGHT_CLASS}`}
          >
            <pre className="m-0 whitespace-pre-wrap font-mono text-[length:var(--readable-code-font-size)] leading-[var(--readable-code-line-height)] text-foreground">
              <code>{output}</code>
            </pre>
          </div>
        </ToolActionDetailsPanel>
      )}
    </ToolActionRow>
  );
}
