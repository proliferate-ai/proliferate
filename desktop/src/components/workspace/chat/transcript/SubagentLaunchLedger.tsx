import { Button } from "@/components/ui/Button";
import { MarkdownRenderer } from "@/components/ui/content/MarkdownRenderer";
import { AutoHideScrollArea } from "@/components/ui/layout/AutoHideScrollArea";
import { ChevronRight, ExternalLink } from "@/components/ui/icons";
import { ToolActionDetailsPanel } from "@/components/workspace/chat/tool-calls/ToolActionDetailsPanel";
import { TOOL_CALL_BODY_MAX_HEIGHT_CLASS } from "@/lib/domain/chat/tool-call-layout";
import { useState } from "react";
import type {
  SubagentExecutionState,
  SubagentProvisioningStatus,
} from "@/lib/domain/chat/subagent-launch";

interface SubagentLaunchLedgerProps {
  prompt: string | null;
  provisioningStatus: SubagentProvisioningStatus | null;
  executionState: SubagentExecutionState;
  childSessionId: string | null;
  onOpenChild?: (childSessionId: string) => void;
}

const CHAT_ACTION_TEXT_CLASS =
  "text-[length:var(--text-chat)] leading-[var(--text-chat--line-height)]";

export function SubagentLaunchLedger({
  prompt,
  provisioningStatus,
  executionState,
  childSessionId,
  onOpenChild,
}: SubagentLaunchLedgerProps) {
  const hasWakeScheduled = provisioningStatus?.wakeScheduled === true
    || provisioningStatus?.wakeScheduleCreated === true;
  const status = formatProvisioningStatus(
    executionState,
    provisioningStatus?.promptStatus ?? null,
  );
  const [promptExpanded, setPromptExpanded] = useState(false);

  return (
    <div className="flex flex-col gap-1">
      <PlainSubagentActionRow
        label={status.label}
        tone={status.tone}
      />
      <SubagentSessionActionRow
        childSessionId={childSessionId}
        onOpenChild={onOpenChild}
        failed={executionState === "failed"}
      />
      {hasWakeScheduled && (
        <PlainSubagentActionRow label="Will wake parent when finished" />
      )}
      {prompt && (
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-chat-transcript-ignore
            className={`group/action-row h-auto max-w-full justify-start gap-1 rounded-none bg-transparent p-0 text-left ${CHAT_ACTION_TEXT_CLASS} font-normal text-muted-foreground/80 hover:bg-transparent hover:text-foreground focus-visible:ring-0`}
            aria-expanded={promptExpanded}
            onClick={() => setPromptExpanded((next) => !next)}
          >
            <span className="min-w-0 truncate">View initial prompt</span>
            <ChevronRight
              className={`size-2.5 shrink-0 text-faint transition-transform duration-200 ${
                promptExpanded ? "rotate-90" : ""
              }`}
            />
          </Button>
          {promptExpanded && (
            <div className="mt-1.5">
              <ToolActionDetailsPanel>
                <AutoHideScrollArea
                  className="w-full"
                  viewportClassName={TOOL_CALL_BODY_MAX_HEIGHT_CLASS}
                >
                  <div className="px-3 py-2 text-sm leading-relaxed text-muted-foreground">
                    <MarkdownRenderer
                      content={prompt}
                      className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
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

function SubagentSessionActionRow({
  childSessionId,
  onOpenChild,
  failed,
}: {
  childSessionId: string | null;
  onOpenChild?: (childSessionId: string) => void;
  failed: boolean;
}) {
  if (!childSessionId || !onOpenChild) {
    return failed ? (
      <PlainSubagentActionRow
        label="Subagent session unavailable"
        tone="failed"
      />
    ) : null;
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      data-chat-transcript-ignore
      className={`group/action-row h-auto max-w-full justify-start gap-1 rounded-none bg-transparent p-0 text-left ${CHAT_ACTION_TEXT_CLASS} font-normal text-muted-foreground/80 hover:bg-transparent hover:text-foreground focus-visible:ring-0`}
      onClick={() => onOpenChild(childSessionId)}
    >
      <span className="min-w-0 truncate">Open subagent</span>
      <ExternalLink className="size-2.5 shrink-0 text-faint opacity-0 transition-opacity duration-200 group-hover/action-row:opacity-100 group-focus-visible/action-row:opacity-100" />
    </Button>
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
        tone === "failed" ? "text-destructive/80" : "text-muted-foreground/80"
      }`}
    >
      {label}
    </div>
  );
}

function formatProvisioningStatus(
  executionState: SubagentExecutionState,
  promptStatus: string | null,
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

  if (promptStatus === "running") {
    return { label: "Working", tone: "normal" };
  }

  if (promptStatus === "queued") {
    return { label: "Prompt queued", tone: "normal" };
  }

  if (executionState === "background") {
    return { label: "Running in background", tone: "normal" };
  }

  if (executionState === "completed_background") {
    return { label: "Completed in background", tone: "normal" };
  }

  return { label: "Started", tone: "normal" };
}
