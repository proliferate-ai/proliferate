import { useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { AutoHideScrollArea } from "@/components/ui/layout/AutoHideScrollArea";
import { ChevronRight, Robot } from "@/components/ui/icons";
import { ToolActionDetailsPanel } from "@/components/workspace/chat/tool-calls/ToolActionDetailsPanel";
import { DelegatedAgentHoverCard } from "@/components/workspace/shell/tabs/DelegatedAgentHoverCard";
import { useTranscriptOpenSession } from "@/components/workspace/chat/transcript/TranscriptContexts";
import type {
  SubagentMcpReceiptPresentation,
} from "@/lib/domain/chat/subagents/subagent-tool-presentation";
import { buildDelegatedAgentIdentity } from "@/lib/domain/delegated-work/identity";
import {
  delegatedWorkStatusCategoryFromLabel,
} from "@/lib/domain/delegated-work/presentation";
import { TOOL_CALL_BODY_MAX_HEIGHT_CLASS } from "@/lib/domain/chat/tools/tool-call-layout";
import type { ToolActionStatus } from "./ToolActionRow";

const CHAT_ACTION_TEXT_CLASS =
  "text-[length:var(--text-chat)] leading-[var(--text-chat--line-height)]";

export function SubagentToolActionRow({
  presentation,
  status,
  resultText,
}: {
  presentation: SubagentMcpReceiptPresentation;
  status: ToolActionStatus;
  resultText?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const openSession = useTranscriptOpenSession();
  const targetSessionId = presentation.childSessionId?.trim() || null;
  const canOpenSession =
    presentation.openSessionAllowed && !!targetSessionId && !!openSession;
  const identity = buildDelegatedAgentIdentity({
    id:
      presentation.sessionLinkId
      ?? presentation.subagentId
      ?? presentation.childSessionId
      ?? presentation.title,
    title: presentation.title,
    sessionId: presentation.childSessionId,
    sessionLinkId: presentation.sessionLinkId,
  });
  const hoverAgent = {
    identity,
    kind: "subagent" as const,
    originLabel: "Subagent",
    statusCategory: delegatedWorkStatusCategoryFromLabel({
      statusLabel: presentation.detailLabel ?? presentation.statusLabel,
    }),
    statusLabel: presentation.detailLabel ?? presentation.statusLabel ?? "Updated",
    parentTitle: null,
    hoverTitle: [
      identity.displayName,
      "Subagent",
      presentation.detailLabel ?? presentation.statusLabel,
    ].filter((value): value is string => !!value).join("\n"),
  };
  const failed = status === "failed";
  const expandable = !!resultText;

  const openTarget = () => {
    if (canOpenSession && targetSessionId) {
      openSession(targetSessionId, "linked-child");
    }
  };

  const identityContent = (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1 align-baseline">
      <Robot className={`size-3 shrink-0 ${identity.textColorClassName}`} />
      <span className={`truncate font-medium ${identity.textColorClassName}`}>
        {identity.displayName}
      </span>
    </span>
  );

  const identityNode = canOpenSession ? (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      data-chat-transcript-ignore
      className="h-auto min-w-0 max-w-full rounded-none bg-transparent p-0 text-left text-[length:var(--text-chat)] font-normal leading-[var(--text-chat--line-height)] hover:bg-transparent focus-visible:ring-0"
      title={`Open ${identity.displayName}`}
      aria-label={`Open ${identity.displayName}`}
      onClick={openTarget}
    >
      {identityContent}
    </Button>
  ) : (
    <span className="inline-flex min-w-0 max-w-full">{identityContent}</span>
  );

  return (
    <div>
      <div
        {...(expandable ? { "data-chat-transcript-ignore": true } : {})}
        className={`group/subagent-action inline-flex min-w-0 max-w-full items-center gap-1 overflow-hidden whitespace-nowrap rounded-none bg-transparent p-0 text-left ${CHAT_ACTION_TEXT_CLASS} font-normal ${
          failed ? "text-destructive/80" : "text-muted-foreground/80"
        }`}
      >
        {expandable && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto rounded-none bg-transparent p-0 hover:bg-transparent focus-visible:ring-0"
            aria-label={expanded ? "Hide subagent tool result" : "Show subagent tool result"}
            aria-expanded={expanded}
            onClick={() => setExpanded((next) => !next)}
          >
            <ChevronRight
              className={`size-3 shrink-0 text-faint transition-transform duration-200 ${
                expanded ? "rotate-90" : ""
              }`}
            />
          </Button>
        )}
        <span className="shrink-0">{presentation.actionLabel}</span>
        <DelegatedAgentHoverCard
          agent={hoverAgent}
          cardAriaLabel={`Open ${identity.displayName}`}
          onCardClick={canOpenSession ? openTarget : undefined}
        >
          {identityNode}
        </DelegatedAgentHoverCard>
        {presentation.detailLabel && (
          <span className="min-w-0 truncate text-muted-foreground/70">
            - {presentation.detailLabel}
          </span>
        )}
      </div>
      {expanded && resultText && (
        <div className="mt-1.5">
          <ToolActionDetailsPanel>
            <AutoHideScrollArea
              className="w-full"
              viewportClassName={TOOL_CALL_BODY_MAX_HEIGHT_CLASS}
            >
              <pre className="m-0 whitespace-pre-wrap px-3 py-2 font-mono text-[length:var(--readable-code-font-size)] leading-[var(--readable-code-line-height)] text-muted-foreground">
                {resultText}
              </pre>
            </AutoHideScrollArea>
          </ToolActionDetailsPanel>
        </div>
      )}
    </div>
  );
}
