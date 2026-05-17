import { useState } from "react";
import type { ToolCallItem, TranscriptState } from "@anyharness/sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import { ChevronRight, Robot } from "@/components/ui/icons";
import { DelegatedAgentHoverCard } from "@/components/workspace/shell/tabs/DelegatedAgentHoverCard";
import {
  parseSubagentLaunchResult,
  parseSubagentProvisioningStatus,
  resolveSubagentLaunchDisplay,
} from "@/lib/domain/chat/subagents/subagent-launch";
import { buildDelegatedAgentIdentity } from "@/lib/domain/delegated-work/identity";
import {
  delegatedWorkStatusCategoryFromLabel,
} from "@/lib/domain/delegated-work/presentation";
import { useTranscriptOpenSession } from "./TranscriptContexts";

const CHAT_BUTTON_TEXT_CLASS = "text-[length:var(--text-chat)] leading-[var(--text-chat--line-height)]";

export function SubagentCreationGroupBlock({
  itemIds,
  transcript,
}: {
  itemIds: readonly string[];
  transcript: TranscriptState;
}) {
  const [expanded, setExpanded] = useState(false);
  const items = itemIds
    .map((itemId) => transcript.itemsById[itemId])
    .filter((item): item is ToolCallItem => item?.kind === "tool_call");
  const openSession = useTranscriptOpenSession();
  const summary = items.length === 1 ? "Created subagent" : `Created ${items.length} subagents`;

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="min-w-0 text-chat leading-[var(--text-chat--line-height)]">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-chat-transcript-ignore
        className={`group/collapsed-actions h-auto max-w-full justify-start gap-1.5 rounded-none bg-transparent p-0 text-left ${CHAT_BUTTON_TEXT_CLASS} font-normal text-muted-foreground/60 hover:bg-transparent hover:text-foreground focus-visible:ring-0 focus-visible:underline`}
        aria-expanded={expanded}
        onClick={() => setExpanded((next) => !next)}
      >
        <span className="min-w-0 truncate">{summary}</span>
        <ChevronRight
          className={`size-3 shrink-0 text-faint opacity-0 transition-all duration-200 group-hover/collapsed-actions:opacity-100 group-focus-visible/collapsed-actions:opacity-100 ${
            expanded ? "rotate-90 opacity-100" : ""
          }`}
        />
      </Button>
      {expanded && (
        <div className="ml-1 space-y-1 border-l border-border/70 pl-2">
          {items.map((item) => (
            <SubagentCreationRow
              key={item.itemId}
              item={item}
              parentTitle={transcript.sessionMeta.title ?? "Parent session"}
              onOpenChild={openSession
                ? (childSessionId) => openSession(childSessionId, "linked-child")
                : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SubagentCreationRow({
  item,
  parentTitle,
  onOpenChild,
}: {
  item: ToolCallItem;
  parentTitle: string;
  onOpenChild?: (childSessionId: string) => void;
}) {
  const launchDisplay = resolveSubagentLaunchDisplay(item);
  const launchResult = parseSubagentLaunchResult(item);
  const provisioningStatus = parseSubagentProvisioningStatus(item);
  const identity = buildDelegatedAgentIdentity({
    id: item.toolCallId ?? item.itemId,
    title: launchDisplay.title,
    sessionId: launchResult?.childSessionId ?? null,
    sessionLinkId: launchResult?.sessionLinkId ?? item.toolCallId ?? item.itemId,
  });
  const promptPreview = formatPromptPreview(launchDisplay.prompt);
  const canOpenChild = !!launchResult?.childSessionId && !!onOpenChild;
  const statusLabel = formatCreationStatusLabel(provisioningStatus?.promptStatus);
  const hoverAgent = {
    identity,
    kind: "subagent" as const,
    originLabel: "Subagent",
    statusCategory: delegatedWorkStatusCategoryFromLabel({
      statusLabel,
      wakeScheduled: provisioningStatus?.wakeScheduled,
    }),
    statusLabel,
    parentTitle,
    hoverTitle: [
      identity.displayName,
      "Subagent",
      parentTitle ? `Parent: ${parentTitle}` : null,
      statusLabel,
    ].filter((value): value is string => !!value).join("\n"),
  };
  const openChild = () => {
    if (canOpenChild) {
      onOpenChild(launchResult.childSessionId!);
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
  const identityNode = canOpenChild ? (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      data-chat-transcript-ignore
      className="h-auto min-w-0 max-w-full rounded-none bg-transparent p-0 text-left text-chat font-normal leading-[var(--text-chat--line-height)] hover:bg-transparent focus-visible:ring-0"
      title={`Open ${identity.displayName}`}
      aria-label={`Open ${identity.displayName}`}
      onClick={openChild}
    >
      {identityContent}
    </Button>
  ) : (
    <span className="inline-flex min-w-0 max-w-full">{identityContent}</span>
  );

  return (
    <div className="flex min-w-0 max-w-full items-center gap-x-1 overflow-hidden whitespace-nowrap text-chat font-normal leading-[var(--text-chat--line-height)] text-muted-foreground">
      <span className="shrink-0">Created subagent</span>
      <DelegatedAgentHoverCard
        agent={hoverAgent}
        cardAriaLabel={`Open ${identity.displayName}`}
        onCardClick={canOpenChild ? openChild : undefined}
      >
        {identityNode}
      </DelegatedAgentHoverCard>
      {promptPreview && (
        <span className="min-w-0 flex-1 truncate">
          with prompt &quot;{promptPreview}&quot;
        </span>
      )}
    </div>
  );
}

function formatPromptPreview(prompt: string | null | undefined): string | null {
  const normalized = prompt
    ?.replace(/\s+/gu, " ")
    .trim();
  if (!normalized) {
    return null;
  }
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

function formatCreationStatusLabel(status: string | null | undefined): string {
  const normalized = status
    ?.replace(/[_-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized) {
    return "Created";
  }
  return normalized.slice(0, 1).toUpperCase() + normalized.slice(1).toLowerCase();
}
