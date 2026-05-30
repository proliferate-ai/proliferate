import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Plus,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { IconButton } from "@proliferate/ui/primitives/IconButton";
import {
  POPOVER_SURFACE_CLASS,
  PopoverButton,
} from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import {
  CloudChatComposer,
  type CloudChatComposerView,
} from "./CloudChatComposer";
import {
  CloudChatTranscript,
  type CloudChatTranscriptPlanActions,
  type CloudChatTranscriptRowView,
} from "./CloudChatTranscript";
import {
  CloudChatTranscriptState,
  type CloudChatTranscriptStateView,
} from "./CloudChatTranscriptState";

export interface CloudChatHeaderActionView {
  label: string;
  kind?: "claim" | "desktop" | "default";
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

export type CloudChatHeaderTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "destructive";

export interface CloudChatStatusView {
  label: string;
  tone: CloudChatHeaderTone;
  live?: boolean;
}

export interface CloudChatHeaderDiagnosticsView {
  text: string;
  onCopy?: () => void;
}

export interface CloudChatHeaderNoticeView {
  title: string;
  description?: string | null;
  tone: Exclude<CloudChatHeaderTone, "neutral" | "success">;
  action?: CloudChatHeaderActionView | null;
  diagnostics?: CloudChatHeaderDiagnosticsView | null;
}

export interface CloudChatSessionOptionView {
  id: string;
  label: string;
  detail?: string | null;
  statusLabel?: string | null;
}

export interface CloudChatSessionSwitcherView {
  workspaceLabel: string;
  activeSessionId: string | null;
  activeSessionLabel: string;
  sessions: readonly CloudChatSessionOptionView[];
  newSessionLabel: string;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
}

export interface CloudChatHeaderView {
  workspaceLabel: string;
  status: CloudChatStatusView;
  sessionSwitcher: CloudChatSessionSwitcherView;
  notice?: CloudChatHeaderNoticeView | null;
  desktopAction?: CloudChatHeaderActionView | null;
}

export interface CloudChatSurfaceProps {
  header: CloudChatHeaderView;
  transcriptRows: readonly CloudChatTranscriptRowView[];
  transcriptState?: CloudChatTranscriptStateView | null;
  transcriptStatus?: string | null;
  transcriptPlanActions?: CloudChatTranscriptPlanActions;
  emptyTitle: string;
  emptyDescription?: string;
  composer: CloudChatComposerView;
  commandMessage?: string | null;
  telemetryBlocked?: boolean;
}

export function CloudChatSurface({
  header,
  transcriptRows,
  transcriptState = null,
  transcriptStatus = null,
  transcriptPlanActions,
  emptyTitle,
  emptyDescription,
  composer,
  commandMessage = null,
  telemetryBlocked = false,
}: CloudChatSurfaceProps) {
  return (
    <div className="flex h-full flex-col" data-telemetry-block={telemetryBlocked || undefined}>
      <header className={`flex h-14 shrink-0 items-center gap-2 px-4 ${
        header.notice ? "border-b border-transparent" : "border-b border-border"
      }`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <h1 className="min-w-0 max-w-[16rem] truncate text-sm font-medium text-foreground">
            {header.workspaceLabel}
          </h1>
          <span className="shrink-0 text-xs text-muted-foreground/50" aria-hidden>
            /
          </span>
          <CloudChatSessionSwitcher view={header.sessionSwitcher} />
          <IconButton
            title={header.sessionSwitcher.newSessionLabel}
            size="sm"
            onClick={header.sessionSwitcher.onNewSession}
            className="shrink-0"
          >
            <Plus size={15} />
          </IconButton>
        </div>
        <CloudChatStatusChip status={header.status} />
        {header.desktopAction ? (
          <Button
            variant="ghost"
            size="sm"
            loading={header.desktopAction.loading}
            disabled={header.desktopAction.disabled}
            onClick={header.desktopAction.onClick}
            className="hidden h-7 shrink-0 gap-1.5 px-2 md:inline-flex"
          >
            <ExternalLink size={13} />
            {header.desktopAction.label}
          </Button>
        ) : null}
      </header>
      {header.notice ? <CloudChatHeaderNotice notice={header.notice} /> : null}

      {transcriptState ? (
        <CloudChatTranscriptState
          view={transcriptState}
          emptyTitle={emptyTitle}
          emptyDescription={emptyDescription}
          pendingStatus={transcriptStatus}
          planActions={transcriptPlanActions}
        />
      ) : (
        <div className="web-scrollbar min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-3xl flex-col px-6 py-6">
            <CloudChatTranscript
              rows={transcriptRows}
              emptyTitle={emptyTitle}
              emptyDescription={emptyDescription}
              planActions={transcriptPlanActions}
            />
          </div>
        </div>
      )}

      <footer className="relative z-20 shrink-0 border-t border-border/40 px-6 py-4">
        <CloudChatComposer composer={composer} />
        {commandMessage ? (
          <p className="mx-auto mt-2 w-full max-w-3xl text-xs text-muted-foreground">
            {commandMessage}
          </p>
        ) : null}
      </footer>
    </div>
  );
}

function CloudChatSessionSwitcher({ view }: { view: CloudChatSessionSwitcherView }) {
  const [open, setOpen] = useState(false);
  const activeSession = view.sessions.find((session) => session.id === view.activeSessionId);
  const activeLabel = activeSession?.label ?? view.activeSessionLabel;

  return (
    <div className="flex min-w-0 shrink items-center">
      <PopoverButton
        align="start"
        side="bottom"
        externalOpen={open}
        onOpenChange={setOpen}
        className={`w-80 max-w-[calc(100vw-2rem)] ${POPOVER_SURFACE_CLASS}`}
        trigger={(
          <Button
            type="button"
            variant="unstyled"
            size="unstyled"
            aria-label={`Switch sessions in ${view.workspaceLabel}. Active session: ${activeLabel}`}
            aria-haspopup="menu"
            aria-expanded={open}
            className="flex h-7 min-w-0 max-w-[20rem] items-center gap-1.5 rounded-md bg-foreground/[0.045] px-2 text-left text-sm text-foreground hover:bg-foreground/[0.07]"
          >
            <span className="min-w-0 truncate">{activeLabel}</span>
            <ChevronDown
              size={13}
              className={`shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
            />
          </Button>
        )}
      >
        {(close) => (
          <div role="menu" aria-label={`Sessions in ${view.workspaceLabel}`}>
            <div className="px-2.5 py-1.5 text-xs font-medium text-muted-foreground">
              {view.sessions.length
                ? `${view.sessions.length} ${view.sessions.length === 1 ? "session" : "sessions"}`
                : "No saved sessions yet"}
            </div>
            {view.sessions.map((session) => (
              <PopoverMenuItem
                key={session.id}
                role="menuitemradio"
                aria-checked={session.id === view.activeSessionId}
                label={session.label}
                trailing={session.statusLabel}
                onClick={() => {
                  close();
                  view.onSelectSession(session.id);
                }}
              >
                {session.detail || null}
              </PopoverMenuItem>
            ))}
            {view.sessions.length ? (
              <div className="my-1 border-t border-border/60" aria-hidden />
            ) : null}
            <PopoverMenuItem
              role="menuitem"
              icon={<Plus size={14} />}
              label={view.newSessionLabel}
              onClick={() => {
                close();
                view.onNewSession();
              }}
            />
          </div>
        )}
      </PopoverButton>
    </div>
  );
}

function CloudChatStatusChip({ status }: { status: CloudChatStatusView }) {
  return (
    <span
      className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-foreground/[0.045] px-2.5 text-xs text-foreground"
      aria-label={`Status: ${status.label}`}
    >
      <StatusDot tone={status.tone} live={status.live} />
      <span className={`max-w-[8rem] truncate ${statusTextClass(status.tone)}`}>
        {status.label}
      </span>
    </span>
  );
}

function CloudChatHeaderNotice({ notice }: { notice: CloudChatHeaderNoticeView }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  function copyDetails() {
    notice.diagnostics?.onCopy?.();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className={`shrink-0 border-y px-4 py-2 text-sm ${noticeToneClass(notice.tone)}`}>
      <div className="flex min-w-0 items-center gap-3">
        <StatusDot tone={notice.tone} live={notice.tone === "info"} />
        <div className="min-w-0 flex-1 leading-5">
          <span className="font-medium">{notice.title}</span>
          {notice.description ? (
            <span className="ml-2 text-muted-foreground">{notice.description}</span>
          ) : null}
        </div>
        {notice.action ? (
          <Button
            variant={notice.action.kind === "claim" ? "secondary" : "outline"}
            size="sm"
            loading={notice.action.loading}
            disabled={notice.action.disabled}
            onClick={notice.action.onClick}
          >
            {notice.action.label}
          </Button>
        ) : null}
        {notice.diagnostics ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((current) => !current)}
            className="gap-1 px-2 text-muted-foreground"
          >
            Details
            <ChevronDown
              size={12}
              className={`transition-transform ${detailsOpen ? "rotate-180" : ""}`}
            />
          </Button>
        ) : null}
      </div>
      {detailsOpen && notice.diagnostics ? (
        <div className="mt-2 flex items-start gap-2 pl-6">
          <code
            className="min-w-0 flex-1 break-words rounded-md bg-background/35 px-2 py-1.5 font-mono text-[11px] leading-5 text-muted-foreground"
            data-telemetry-mask
          >
            {notice.diagnostics.text}
          </code>
          <IconButton
            title={copied ? "Copied" : "Copy details"}
            size="sm"
            onClick={copyDetails}
            className="shrink-0 border-border/60"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </IconButton>
        </div>
      ) : null}
    </div>
  );
}

function StatusDot({
  tone,
  live = false,
}: {
  tone: CloudChatHeaderTone;
  live?: boolean;
}) {
  return (
    <span
      className={`size-1.5 shrink-0 rounded-full ${statusDotClass(tone)} ${
        live ? "animate-pulse motion-reduce:animate-none" : ""
      }`}
      aria-hidden
    />
  );
}

function statusDotClass(tone: CloudChatHeaderTone): string {
  switch (tone) {
    case "info":
      return "bg-info";
    case "success":
      return "bg-success";
    case "warning":
      return "bg-warning";
    case "destructive":
      return "bg-destructive";
    case "neutral":
    default:
      return "bg-muted-foreground/55";
  }
}

function statusTextClass(tone: CloudChatHeaderTone): string {
  switch (tone) {
    case "info":
      return "text-info";
    case "success":
      return "text-success";
    case "warning":
      return "text-warning";
    case "destructive":
      return "text-destructive";
    case "neutral":
    default:
      return "text-muted-foreground";
  }
}

function noticeToneClass(tone: CloudChatHeaderNoticeView["tone"]): string {
  switch (tone) {
    case "info":
      return "border-info/20 bg-info/10 text-foreground";
    case "destructive":
      return "border-destructive/25 bg-destructive-subtle text-foreground";
    case "warning":
    default:
      return "border-warning/25 bg-warning-subtle text-foreground";
  }
}
