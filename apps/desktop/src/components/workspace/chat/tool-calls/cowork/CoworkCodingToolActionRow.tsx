import type { ToolCallItem, ToolResultTextContentPart } from "@anyharness/sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import {
  ExternalLink,
  FolderPlus,
  GitBranch,
  Spinner,
} from "@proliferate/ui/icons";
import { ProliferateIcon } from "@proliferate/ui/proliferate-icons";
import { ToolActionRow } from "@/components/workspace/chat/tool-calls/ToolActionRow";
import {
  CoworkCodingLedger,
  CoworkCodingResultDetails,
  shouldShowCoworkCodingLedger,
} from "@/components/workspace/chat/tool-calls/cowork/CoworkCodingToolLedger";
import {
  deriveCoworkCodingToolPresentation,
  type CoworkCodingAction,
} from "@proliferate/product-domain/chats/tools/cowork-coding-tool-presentation";
import { normalizeToolResultText } from "@proliferate/product-domain/chats/tools/tool-result-text";

interface CoworkCodingToolActionRowProps {
  item: ToolCallItem;
  onOpenCodingSession?: (input: {
    workspaceId: string;
    sessionId: string;
    parentSessionId?: string | null;
    sessionLinkId?: string | null;
  }) => void;
  onOpenWorkspace?: (workspaceId: string) => void;
}

const SPINNER_COLOR =
  "color-mix(in oklab, var(--color-highlight-muted) 70%, var(--color-muted-foreground) 30%)";

export function CoworkCodingToolActionRow({
  item,
  onOpenCodingSession,
  onOpenWorkspace,
}: CoworkCodingToolActionRowProps) {
  const presentation = deriveCoworkCodingToolPresentation(item);
  if (!presentation) {
    return null;
  }

  const resultText = shouldShowCoworkCodingLedger(presentation.action)
    ? ""
    : extractNormalizedResultText(item);
  const canOpenCodingSession =
    !!presentation.workspaceId
    && !!presentation.codingSessionId
    && !!onOpenCodingSession;
  const openCodingSession = canOpenCodingSession
    ? () => onOpenCodingSession?.({
      workspaceId: presentation.workspaceId!,
      sessionId: presentation.codingSessionId!,
      parentSessionId: presentation.parentSessionId,
      sessionLinkId: presentation.sessionLinkId,
    })
    : undefined;
  const openWorkspace = presentation.action === "create_workspace"
    && !!presentation.workspaceId
    && !!onOpenWorkspace
      ? () => onOpenWorkspace(presentation.workspaceId!)
      : undefined;
  const showLedger = shouldShowCoworkCodingLedger(presentation.action);
  const expandable = showLedger || resultText.length > 0;

  return (
    <div data-telemetry-mask="true">
      <ToolActionRow
        icon={presentation.running ? (
          <RunningIcon />
        ) : (
          <CoworkCodingIcon action={presentation.action} />
        )}
        label={presentation.label}
        status={mapStatus(item.status)}
        hint={(
          <CoworkCodingHint
            action={presentation.action}
            displayName={presentation.displayName}
            meta={presentation.meta}
            eventCount={presentation.eventCount}
            truncated={presentation.truncated}
            onOpen={openCodingSession ?? openWorkspace}
          />
        )}
        expandable={expandable}
        defaultExpanded={showLedger && item.status !== "in_progress"}
      >
        {showLedger && (
          <CoworkCodingLedger
            action={presentation.action}
            prompt={presentation.prompt}
            promptStatus={presentation.promptStatus}
            canOpenCodingSession={!!openCodingSession}
            onOpenCodingSession={openCodingSession}
            canOpenWorkspace={!!openWorkspace}
            onOpenWorkspace={openWorkspace}
            failed={item.status === "failed"}
          />
        )}
        {!showLedger && resultText && (
          <CoworkCodingResultDetails content={resultText} />
        )}
      </ToolActionRow>
    </div>
  );
}

function CoworkCodingIcon({
  action,
}: {
  action: CoworkCodingAction;
}) {
  if (action === "create_workspace") {
    return <FolderPlus className="size-2.5 text-faint" />;
  }
  if (action === "create_session" || action === "send_message" || action === "schedule_wake") {
    return <GitBranch className="size-2.5 text-faint" />;
  }
  return <ProliferateIcon className="size-2.5 text-faint" />;
}

function RunningIcon() {
  return (
    <span className="inline-flex size-3 items-center justify-center" style={{ color: SPINNER_COLOR }}>
      <Spinner className="size-3 opacity-80" />
    </span>
  );
}

function CoworkCodingHint({
  action,
  displayName,
  meta,
  eventCount,
  truncated,
  onOpen,
}: {
  action: CoworkCodingAction;
  displayName: string | null;
  meta: string | null;
  eventCount: number | null;
  truncated: boolean | null;
  onOpen?: () => void;
}) {
  const eventSummary = eventCount === null
    ? null
    : `${eventCount} event${eventCount === 1 ? "" : "s"}${truncated ? " · capped" : ""}`;

  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1">
      {displayName && (
        <span className="min-w-0 max-w-[180px] truncate text-foreground/90">
          {displayName}
        </span>
      )}
      {meta && (
        <span className="min-w-0 max-w-[180px] truncate text-sm text-muted-foreground">
          {meta}
        </span>
      )}
      {eventSummary && (
        <span className="shrink-0 text-sm text-muted-foreground">
          {eventSummary}
        </span>
      )}
      {onOpen && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          data-chat-transcript-ignore
          title={action === "create_workspace" ? "Open coding workspace session" : "Open coding session"}
          aria-label={action === "create_workspace" ? "Open coding workspace session" : "Open coding session"}
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
          className="ml-0.5 size-4 rounded-full px-0 text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="size-2.5" />
        </Button>
      )}
    </span>
  );
}

function extractNormalizedResultText(item: ToolCallItem): string {
  const text = item.contentParts
    .filter((part): part is ToolResultTextContentPart => part.type === "tool_result_text")
    .map((part) => part.text)
    .join("\n\n");
  return normalizeToolResultText(text);
}

function mapStatus(
  status: ToolCallItem["status"],
): "running" | "completed" | "failed" {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return "running";
}
