import { useState } from "react";
import type { ToolCallItem } from "@anyharness/sdk";
import { CommandWindow } from "#product/primitives/icons/workspace";
import { AutoHideScrollArea } from "#product/primitives/patterns/AutoHideScrollArea";
import { TOOL_CALL_BODY_MAX_HEIGHT_CLASS } from "@proliferate/product-domain/chats/tools/tool-call-layout";
import {
  deriveCommand,
  deriveCommandOutput,
  formatCommandExecutionLabel,
} from "@proliferate/product-domain/chats/tools/collapsed-action-labels";
import { ActionDisclosureRow } from "#product/components/workspace/chat/tool-calls/CollapsedActionRowPrimitives";

export function CommandActionRow({ item }: { item: ToolCallItem }) {
  const [expanded, setExpanded] = useState(false);
  const command = deriveCommand(item);
  const output = deriveCommandOutput(item);
  const label = formatCommandExecutionLabel(command, item.status);

  return (
    <div>
      <ActionDisclosureRow
        label={label}
        icon={<CommandWindow />}
        expanded={expanded}
        failed={item.status === "failed"}
        onToggle={() => setExpanded((value) => !value)}
      />
      {expanded && (
        <div className="mt-1.5 overflow-hidden rounded-lg border border-border/60 bg-surface-elevated-secondary">
          <div className="flex items-center justify-between gap-2 px-2 py-1 text-chat text-muted-foreground">
            <span>Shell</span>
          </div>
          <div className="px-2 pb-2">
            <code className="block whitespace-pre-wrap break-words font-mono text-readable-code text-muted-foreground">
              $ {command}
            </code>
          </div>
          <AutoHideScrollArea
            className="border-t border-border/60"
            viewportClassName={TOOL_CALL_BODY_MAX_HEIGHT_CLASS}
            allowHorizontal
          >
            <pre className="m-0 whitespace-pre-wrap p-2 font-mono text-readable-code text-muted-foreground">
              <code>{output || "No output"}</code>
            </pre>
          </AutoHideScrollArea>
        </div>
      )}
    </div>
  );
}
