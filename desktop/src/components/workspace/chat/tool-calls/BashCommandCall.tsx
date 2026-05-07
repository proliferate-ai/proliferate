import { Terminal } from "@/components/ui/icons";
import { TOOL_CALL_BODY_MAX_HEIGHT_CLASS } from "@/lib/domain/chat/tools/tool-call-layout";
import { ToolActionDetailsPanel } from "./ToolActionDetailsPanel";
import { ToolActionRow } from "./ToolActionRow";

interface BashCommandCallProps {
  command: string;
  description?: string;
  output?: string;
  status: "running" | "completed" | "failed";
  duration?: string;
  defaultExpanded?: boolean;
}

export function BashCommandCall({
  command,
  description,
  output,
  status,
  duration,
  defaultExpanded = false,
}: BashCommandCallProps) {
  const label = description
    ?? (status === "failed" ? "Command" : "Running command");

  return (
    <ToolActionRow
      icon={<Terminal />}
      label={
        <span className="font-[460] text-foreground/90">{label}</span>
      }
      hint={command}
      status={status}
      duration={duration}
      defaultExpanded={defaultExpanded}
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
