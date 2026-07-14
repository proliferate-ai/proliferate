import type { ReactNode } from "react";
import { AutoHideScrollArea } from "@proliferate/ui/layout/AutoHideScrollArea";
import { TOOL_CALL_BODY_MAX_HEIGHT_CLASS } from "@proliferate/product-domain/chats/tools/tool-call-layout";
import { ToolActionDetailsPanel } from "#product/components/workspace/chat/tool-calls/ToolActionDetailsPanel";
import { ToolActionRow, type ToolActionStatus } from "#product/components/workspace/chat/tool-calls/ToolActionRow";

interface GenericToolResultRowProps {
  icon?: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
  status: ToolActionStatus;
  resultText?: string | null;
}

export function GenericToolResultRow({
  icon,
  label,
  hint,
  status,
  resultText,
}: GenericToolResultRowProps) {
  return (
    <ToolActionRow
      icon={icon}
      label={label}
      hint={hint}
      status={status}
      expandable={!!resultText}
    >
      {resultText ? (
        <ToolActionDetailsPanel>
          <AutoHideScrollArea
            className="w-full"
            viewportClassName={TOOL_CALL_BODY_MAX_HEIGHT_CLASS}
          >
            <pre className="m-0 whitespace-pre-wrap px-3 py-2 font-mono text-[length:var(--readable-code-font-size)] leading-[var(--readable-code-line-height)] text-foreground">
              {resultText}
            </pre>
          </AutoHideScrollArea>
        </ToolActionDetailsPanel>
      ) : null}
    </ToolActionRow>
  );
}
