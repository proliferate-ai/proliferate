import { Button } from "#product/primitives/Button";
import { MarkdownBody } from "#product/components/workspace/chat/transcript/MarkdownBody";
import { renderDesktopCodeBlock } from "#product/components/content/ui/desktop-markdown-code-block";
import { AutoHideScrollArea } from "#product/primitives/patterns/AutoHideScrollArea";
import { StickyNote } from "#product/primitives/icons/product";
import { ToolActionDetailsPanel } from "#product/components/workspace/chat/tool-calls/ToolActionDetailsPanel";
import { TOOL_CALL_BODY_MAX_HEIGHT_CLASS } from "#product/domain/chats/tools/tool-call-layout";
import { useState } from "react";
import type { SubagentExecutionState } from "#product/domain/chats/subagents/subagent-launch";

interface SubagentLaunchLedgerProps {
  prompt: string | null;
  executionState: SubagentExecutionState;
}

const CHAT_ACTION_TEXT_CLASS =
  "text-chat";

export function SubagentLaunchLedger({
  prompt,
  executionState,
}: SubagentLaunchLedgerProps) {
  const status = formatLaunchStatus(executionState);
  const [promptExpanded, setPromptExpanded] = useState(false);

  return (
    <div className="flex flex-col gap-1">
      <PlainSubagentActionRow
        label={status.label}
        tone={status.tone}
      />
      {prompt && (
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-chat-transcript-ignore
            className={`group/action-row h-auto max-w-full justify-start gap-1 rounded-none bg-transparent p-0 text-left ${CHAT_ACTION_TEXT_CLASS} font-normal text-muted-foreground/60 hover:bg-transparent hover:text-foreground focus-visible:ring-0`}
            aria-expanded={promptExpanded}
            onClick={() => setPromptExpanded((next) => !next)}
          >
            <StickyNote
              aria-hidden="true"
              className={`icon-compact shrink-0 transition-colors ${
                promptExpanded ? "text-foreground/70" : "text-faint"
              }`}
            />
            <span className="min-w-0 truncate">View initial prompt</span>
          </Button>
          {promptExpanded && (
            <div className="mt-1.5">
              <ToolActionDetailsPanel>
                <AutoHideScrollArea
                  className="w-full"
                  viewportClassName={TOOL_CALL_BODY_MAX_HEIGHT_CLASS}
                  chainVerticalWheel
                >
                  <div className="px-3 py-2 text-chat leading-relaxed text-muted-foreground">
                    <MarkdownBody
                      content={prompt}
                      className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                      renderCodeBlock={renderDesktopCodeBlock}
                    />
                  </div>
                </AutoHideScrollArea>
              </ToolActionDetailsPanel>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PlainSubagentActionRow({
  label,
  tone = "normal",
}: {
  label: string;
  tone?: "normal" | "failed";
}) {
  return (
    <div
      title={label}
      className={`truncate ${CHAT_ACTION_TEXT_CLASS} ${
        tone === "failed" ? "text-destructive/80" : "text-muted-foreground/60"
      }`}
    >
      {label}
    </div>
  );
}

function formatLaunchStatus(
  executionState: SubagentExecutionState,
): { label: string; tone: "normal" | "failed" } {
  if (executionState === "failed") {
    return { label: "Launch failed", tone: "failed" };
  }

  if (executionState === "expired_background") {
    return { label: "Stopped updating", tone: "failed" };
  }

  if (executionState === "running") {
    return { label: "Creating", tone: "normal" };
  }

  if (executionState === "background") {
    return { label: "Running in background", tone: "normal" };
  }

  if (executionState === "completed_background") {
    return { label: "Completed in background", tone: "normal" };
  }

  return { label: "Started", tone: "normal" };
}
