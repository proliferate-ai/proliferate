import { useState } from "react";
import type {
  ToolCallContentPart,
  ToolCallItem,
} from "@anyharness/sdk";
import { AutoHideScrollArea } from "@proliferate/ui/layout/AutoHideScrollArea";
import { describeToolCallDisplay } from "@proliferate/product-domain/chats/tools/tool-call-display";
import { TOOL_CALL_BODY_MAX_HEIGHT_CLASS } from "@proliferate/product-domain/chats/tools/tool-call-layout";
import { deriveGenericToolOutput } from "@proliferate/product-domain/chats/tools/collapsed-action-labels";
import {
  ActionDisclosureRow,
  PlainActionRow,
} from "./CollapsedActionRowPrimitives";
import { CollapsedActionIcon } from "./CollapsedActionIcon";

export function GenericActionRow({ item }: { item: ToolCallItem }) {
  const [expanded, setExpanded] = useState(false);
  const toolCallPart = item.contentParts.find(
    (part): part is ToolCallContentPart => part.type === "tool_call",
  );
  const toolName = toolCallPart?.title ?? item.title ?? item.nativeToolName ?? "Tool call";
  const display = describeToolCallDisplay(item, toolName);
  const label = item.status === "failed"
    ? `${display.label} failed`
    : item.status === "in_progress"
      ? `${display.label} running`
      : display.label;
  const output = deriveGenericToolOutput(item);

  if (output) {
    return (
      <div>
        <ActionDisclosureRow
          label={display.hint ? `${label} ${display.hint}` : label}
          icon={<CollapsedActionIcon kind="action" />}
          expanded={expanded}
          failed={item.status === "failed"}
          onToggle={() => setExpanded((value) => !value)}
        />
        {expanded && (
          <div className="mt-1.5 overflow-hidden rounded-lg border border-border/60 bg-foreground/[0.04]">
            <div className="flex items-center justify-between gap-2 px-2 py-1 text-sm text-muted-foreground">
              <span>Result</span>
            </div>
            <AutoHideScrollArea
              className="border-t border-border/60"
              viewportClassName={TOOL_CALL_BODY_MAX_HEIGHT_CLASS}
              allowHorizontal
            >
              <pre className="m-0 whitespace-pre-wrap p-2 font-mono text-[length:var(--readable-code-font-size)] leading-[var(--readable-code-line-height)] text-muted-foreground">
                <code>{output}</code>
              </pre>
            </AutoHideScrollArea>
          </div>
        )}
      </div>
    );
  }

  return (
    <PlainActionRow
      icon={<CollapsedActionIcon kind="action" />}
      tone={item.status === "failed" ? "failed" : "normal"}
      label={display.hint ? `${label} ${display.hint}` : label}
    />
  );
}
