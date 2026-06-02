import { useState } from "react";
import { AutoHideScrollArea } from "@proliferate/ui/layout/AutoHideScrollArea";
import { ExternalLink, MessageSquare } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { MarkdownRenderer } from "@/components/content/ui/MarkdownRenderer";
import { ToolActionDetailsPanel } from "@/components/workspace/chat/tool-calls/ToolActionDetailsPanel";
import { TOOL_CALL_BODY_MAX_HEIGHT_CLASS } from "@proliferate/product-domain/chats/tools/tool-call-layout";
import type { CoworkCodingAction } from "@proliferate/product-domain/chats/tools/cowork-coding-tool-presentation";

const CHAT_ACTION_TEXT_CLASS =
  "text-[length:var(--text-chat)] leading-[var(--text-chat--line-height)]";

export function shouldShowCoworkCodingLedger(action: CoworkCodingAction): boolean {
  return (
    action === "create_workspace"
    || action === "create_session"
    || action === "send_message"
    || action === "schedule_wake"
  );
}

export function CoworkCodingLedger({
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
      data-chat-transcript-ignore
      className={`group/action-row h-auto max-w-full justify-start gap-1 rounded-none bg-transparent p-0 text-left ${CHAT_ACTION_TEXT_CLASS} font-normal text-muted-foreground/60 hover:bg-transparent hover:text-foreground focus-visible:ring-0`}
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
        data-chat-transcript-ignore
        className={`group/action-row h-auto max-w-full justify-start gap-1 rounded-none bg-transparent p-0 text-left ${CHAT_ACTION_TEXT_CLASS} font-normal text-muted-foreground/60 hover:bg-transparent hover:text-foreground focus-visible:ring-0`}
        aria-expanded={expanded}
        onClick={() => setExpanded((next) => !next)}
      >
        <MessageSquare
          aria-hidden="true"
          className={`size-2.5 shrink-0 transition-colors ${
            expanded ? "text-foreground/70" : "text-faint"
          }`}
        />
        <span className="min-w-0 truncate">{label}</span>
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
      data-chat-transcript-ignore
      className={`group/action-row h-auto max-w-full justify-start gap-1 rounded-none bg-transparent p-0 text-left ${CHAT_ACTION_TEXT_CLASS} font-normal text-muted-foreground/60 hover:bg-transparent hover:text-foreground focus-visible:ring-0`}
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
        tone === "failed" ? "text-destructive/80" : "text-muted-foreground/60"
      }`}
    >
      {label}
    </div>
  );
}

export function CoworkCodingResultDetails({ content }: { content: string }) {
  return (
    <ToolActionDetailsPanel>
      <AutoHideScrollArea
        className="w-full"
        viewportClassName={TOOL_CALL_BODY_MAX_HEIGHT_CLASS}
      >
        <pre className="m-0 whitespace-pre-wrap px-3 py-2 font-mono text-[length:var(--readable-code-font-size)] leading-[var(--readable-code-line-height)] text-foreground">
          {content}
        </pre>
      </AutoHideScrollArea>
    </ToolActionDetailsPanel>
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
