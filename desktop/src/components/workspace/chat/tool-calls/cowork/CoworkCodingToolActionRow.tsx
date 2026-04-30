import type { ToolCallItem } from "@anyharness/sdk";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { MarkdownRenderer } from "@/components/ui/content/MarkdownRenderer";
import {
  ChevronRight,
  ExternalLink,
  FolderPlus,
  GitBranch,
  ProliferateIcon,
} from "@/components/ui/icons";
import { AutoHideScrollArea } from "@/components/ui/layout/AutoHideScrollArea";
import { ToolActionDetailsPanel } from "@/components/workspace/chat/tool-calls/ToolActionDetailsPanel";
import { ToolActionRow } from "@/components/workspace/chat/tool-calls/ToolActionRow";
import { useBrailleFillsweep } from "@/hooks/ui/use-braille-sweep";
import {
  deriveCoworkCodingToolPresentation,
  type CoworkCodingAction,
} from "@/lib/domain/chat/cowork-coding-tool-presentation";
import { TOOL_CALL_BODY_MAX_HEIGHT_CLASS } from "@/lib/domain/chat/tool-call-layout";

interface CoworkCodingToolActionRowProps {
  item: ToolCallItem;
  onOpenCodingSession?: (input: { workspaceId: string; sessionId: string }) => void;
  onOpenWorkspace?: (workspaceId: string) => void;
}

const SPINNER_COLOR =
  "color-mix(in oklab, var(--color-highlight-muted) 70%, var(--color-muted-foreground) 30%)";
const CHAT_ACTION_TEXT_CLASS =
  "text-[length:var(--text-chat)] leading-[var(--text-chat--line-height)]";

export function CoworkCodingToolActionRow({
  item,
  onOpenCodingSession,
  onOpenWorkspace,
}: CoworkCodingToolActionRowProps) {
  const presentation = deriveCoworkCodingToolPresentation(item);
  if (!presentation) {
    return null;
  }

  const canOpenCodingSession =
    !!presentation.workspaceId
    && !!presentation.codingSessionId
    && !!onOpenCodingSession;
  const openCodingSession = canOpenCodingSession
    ? () => onOpenCodingSession?.({
      workspaceId: presentation.workspaceId!,
      sessionId: presentation.codingSessionId!,
    })
    : undefined;
  const openWorkspace = presentation.action === "create_workspace"
    && !!presentation.workspaceId
    && !!onOpenWorkspace
      ? () => onOpenWorkspace(presentation.workspaceId!)
      : undefined;
  const showLedger = shouldShowLedger(presentation.action);

  return (
    <div data-telemetry-mask="true">
      <ToolActionRow
        icon={presentation.running ? (
          <RunningIcon />
        ) : (
          <CoworkCodingIcon action={presentation.action} />
        )}
        label={<span className="font-[460] text-foreground/90">{presentation.label}</span>}
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
        expandable={showLedger}
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
      </ToolActionRow>
    </div>
  );
}

function shouldShowLedger(action: CoworkCodingAction): boolean {
  return action === "create_workspace"
    || action === "create_session"
    || action === "send_message"
    || action === "schedule_wake";
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
  const frame = useBrailleFillsweep();

  return (
    <span
      className="inline-block w-[1em] shrink-0 font-mono leading-none tracking-[-0.18em] opacity-80"
      style={{ color: SPINNER_COLOR }}
    >
      {frame}
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

function CoworkCodingLedger({
  action,
  prompt,
  promptStatus,
  canOpenCodingSession,
  onOpenCodingSession,
  canOpenWorkspace,
  onOpenWorkspace,
  failed,
}: {
  action: CoworkCodingAction;
  prompt: string | null;
  promptStatus: string | null;
  canOpenCodingSession: boolean;
  onOpenCodingSession?: () => void;
  canOpenWorkspace: boolean;
  onOpenWorkspace?: () => void;
  failed: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      {prompt && (
        <PromptActionRow
          label={action === "send_message" ? "Sent coding message" : "Sent prompt to coding session"}
          prompt={prompt}
        />
      )}
      {action === "create_workspace" && (
        <CodingWorkspaceActionRow
          canOpen={canOpenWorkspace}
          onOpen={onOpenWorkspace}
          failed={failed}
        />
      )}
      {action === "create_session" && (
        <CodingSessionActionRow
          canOpen={canOpenCodingSession}
          onOpen={onOpenCodingSession}
          failed={failed}
        />
      )}
      {action === "schedule_wake" && (
        <PlainCoworkCodingActionRow label="Wake scheduled" />
      )}
      <PlainCoworkCodingActionRow
        label={formatPromptStatus(action, promptStatus, failed)}
        tone={failed ? "failed" : "normal"}
      />
    </div>
  );
}

function CodingWorkspaceActionRow({
  canOpen,
  onOpen,
  failed,
}: {
  canOpen: boolean;
  onOpen?: () => void;
  failed: boolean;
}) {
  if (!canOpen || !onOpen) {
    return (
      <PlainCoworkCodingActionRow
        label={failed ? "Coding workspace was not created" : "Created coding workspace"}
        tone={failed ? "failed" : "normal"}
      />
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={`group/action-row h-auto max-w-full justify-start gap-1 rounded-none bg-transparent p-0 text-left ${CHAT_ACTION_TEXT_CLASS} font-normal text-muted-foreground/80 hover:bg-transparent hover:text-foreground focus-visible:ring-0`}
      onClick={onOpen}
    >
      <span className="min-w-0 truncate">Created coding workspace</span>
      <ExternalLink className="size-2.5 shrink-0 text-faint opacity-0 transition-opacity duration-200 group-hover/action-row:opacity-100 group-focus-visible/action-row:opacity-100" />
    </Button>
  );
}

function PromptActionRow({
  label,
  prompt,
}: {
  label: string;
  prompt: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={`group/action-row h-auto max-w-full justify-start gap-1 rounded-none bg-transparent p-0 text-left ${CHAT_ACTION_TEXT_CLASS} font-normal text-muted-foreground/80 hover:bg-transparent hover:text-foreground focus-visible:ring-0`}
        aria-expanded={expanded}
        onClick={() => setExpanded((next) => !next)}
      >
        <span className="min-w-0 truncate">{label}</span>
        <ChevronRight
          className={`size-2.5 shrink-0 text-faint transition-transform duration-200 ${
            expanded ? "rotate-90" : ""
          }`}
        />
      </Button>
      {expanded && (
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
  );
}

function CodingSessionActionRow({
  canOpen,
  onOpen,
  failed,
}: {
  canOpen: boolean;
  onOpen?: () => void;
  failed: boolean;
}) {
  if (!canOpen || !onOpen) {
    return (
      <PlainCoworkCodingActionRow
        label={failed ? "Coding session was not created" : "Creating coding session"}
        tone={failed ? "failed" : "normal"}
      />
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={`group/action-row h-auto max-w-full justify-start gap-1 rounded-none bg-transparent p-0 text-left ${CHAT_ACTION_TEXT_CLASS} font-normal text-muted-foreground/80 hover:bg-transparent hover:text-foreground focus-visible:ring-0`}
      onClick={onOpen}
    >
      <span className="min-w-0 truncate">Created coding session</span>
      <ExternalLink className="size-2.5 shrink-0 text-faint opacity-0 transition-opacity duration-200 group-hover/action-row:opacity-100 group-focus-visible/action-row:opacity-100" />
    </Button>
  );
}

function PlainCoworkCodingActionRow({
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

function formatPromptStatus(
  action: CoworkCodingAction,
  promptStatus: string | null,
  failed: boolean,
): string {
  if (failed) {
    if (action === "send_message") return "Coding message failed";
    if (action === "create_workspace") return "Coding workspace failed";
    if (action === "schedule_wake") return "Wake schedule failed";
    return "Coding session failed";
  }
  if (action === "create_workspace") {
    return "Coding workspace ready";
  }
  if (action === "schedule_wake") {
    return "Wake scheduled";
  }
  if (promptStatus === "queued") {
    return "Coding prompt queued";
  }
  if (promptStatus === "running") {
    return "Coding session running";
  }
  return action === "send_message" ? "Coding message sent" : "Coding session started";
}

function mapStatus(
  status: ToolCallItem["status"],
): "running" | "completed" | "failed" {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return "running";
}
