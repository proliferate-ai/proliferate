import {
  ToolCallBlock,
  TOOL_CALL_BODY_MAX_HEIGHT_CLASS,
} from "./ToolCallBlock";
import { Terminal } from "@/components/ui/icons";

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
    ?? (status === "running" ? "Running command" : "Command");

  return (
    <ToolCallBlock
      icon={<Terminal />}
      name={
        <span className="font-[460] text-foreground/90">{label}</span>
      }
      hint={command}
      status={status}
      duration={duration}
      defaultExpanded={defaultExpanded}
      bodyClassName="overflow-hidden"
    >
      {output && (
        <div className="overflow-hidden rounded-md border border-border/60 bg-muted/25">
          <div
            className={`w-full overflow-y-auto px-3 py-2 ${TOOL_CALL_BODY_MAX_HEIGHT_CLASS}`}
          >
            <pre className="m-0 whitespace-pre-wrap font-mono text-xs text-foreground">
              <code>{output}</code>
            </pre>
          </div>
        </div>
      )}
    </ToolCallBlock>
  );
}
