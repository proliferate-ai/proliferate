import {
  ArrowLeft,
  ExternalLink,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { IconButton } from "@proliferate/ui/primitives/IconButton";
import {
  CloudChatComposer,
  type CloudChatComposerView,
} from "./CloudChatComposer";
import {
  CloudChatTranscript,
  type CloudChatTranscriptRowView,
} from "./CloudChatTranscript";

export interface CloudChatChipView {
  id: string;
  label: string;
  icon?: "branch";
}

export interface CloudChatPrimaryActionView {
  label: string;
  kind?: "claim" | "continue" | "default";
  loading?: boolean;
  onClick?: () => void;
}

export interface CloudChatHeaderActionView {
  id: string;
  label: string;
  kind?: "new-session" | "default";
  loading?: boolean;
  onClick?: () => void;
}

export interface CloudChatTopNoticeView {
  title: string;
  description?: string | null;
  action?: CloudChatPrimaryActionView | null;
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

export interface CloudChatSurfaceProps {
  title: string;
  eyebrowItems: readonly string[];
  chips: readonly CloudChatChipView[];
  transcriptRows: readonly CloudChatTranscriptRowView[];
  emptyTitle: string;
  emptyDescription?: string;
  composer: CloudChatComposerView;
  commandMessage?: string | null;
  primaryAction?: CloudChatPrimaryActionView | null;
  headerActions?: readonly CloudChatHeaderActionView[];
  sessionSwitcher?: CloudChatSessionSwitcherView | null;
  topNotice?: CloudChatTopNoticeView | null;
  desktopHref?: string | null;
  telemetryBlocked?: boolean;
  onBack: () => void;
}

export function CloudChatSurface({
  title,
  eyebrowItems,
  chips: _chips,
  transcriptRows,
  emptyTitle,
  emptyDescription,
  composer,
  commandMessage = null,
  primaryAction = null,
  headerActions = [],
  sessionSwitcher = null,
  topNotice = null,
  desktopHref = null,
  telemetryBlocked = false,
  onBack,
}: CloudChatSurfaceProps) {
  return (
    <div className="flex h-full flex-col" data-telemetry-block={telemetryBlocked || undefined}>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <IconButton title="Back" size="sm" onClick={onBack}>
          <ArrowLeft size={15} />
        </IconButton>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <h1 className="truncate text-sm font-medium text-foreground">{title}</h1>
          {sessionSwitcher ? (
            <CloudChatSessionSwitcher view={sessionSwitcher} />
          ) : eyebrowItems[0] ? (
            <span className="truncate rounded-lg border border-border/60 bg-foreground/[0.03] px-2.5 py-1 text-sm text-muted-foreground">
              {eyebrowItems[0]}
            </span>
          ) : null}
        </div>
        {primaryAction ? (
          <Button
            variant={primaryAction.kind === "claim" ? "secondary" : "outline"}
            size="sm"
            loading={primaryAction.loading}
            onClick={primaryAction.onClick}
          >
            {primaryAction.kind === "continue" ? <ExternalLink size={14} /> : null}
            {primaryAction.label}
          </Button>
        ) : null}
        {headerActions.map((action) => (
          <Button
            key={action.id}
            variant="outline"
            size="sm"
            loading={action.loading}
            onClick={action.onClick}
          >
            {action.kind === "new-session" ? <Plus size={14} /> : null}
            {action.label}
          </Button>
        ))}
        {desktopHref ? (
          <a
            href={desktopHref}
            className="inline-flex h-8 items-center gap-2 rounded-md border border-input px-3 text-xs text-muted-foreground hover:bg-accent"
          >
            <ExternalLink size={14} />
            Desktop
          </a>
        ) : null}
        <IconButton title="Session menu" size="sm">
          <MoreHorizontal size={15} />
        </IconButton>
      </header>
      {topNotice ? (
        <div className="flex shrink-0 items-center gap-3 border-b border-warning/20 bg-warning-subtle px-4 py-2 text-sm text-warning">
          <div className="min-w-0 flex-1 leading-5">
            <div className="font-medium">{topNotice.title}</div>
            {topNotice.description ? (
              <div className="text-warning/80">{topNotice.description}</div>
            ) : null}
          </div>
          {topNotice.action ? (
            <Button
              variant="secondary"
              size="sm"
              loading={topNotice.action.loading}
              onClick={topNotice.action.onClick}
            >
              {topNotice.action.label}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="web-scrollbar min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col px-6 py-6">
          <CloudChatTranscript
            rows={transcriptRows}
            emptyTitle={emptyTitle}
            emptyDescription={emptyDescription}
          />
        </div>
      </div>

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

  return (
    <div className="relative flex min-w-0 shrink items-center gap-1.5">
      <button
        type="button"
        aria-label={`Switch sessions in ${view.workspaceLabel}`}
        disabled={view.sessions.length === 0}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex h-8 min-w-0 max-w-[18rem] items-center gap-2 rounded-lg border border-border/70 bg-foreground/[0.035] px-2.5 text-left text-sm text-foreground outline-none hover:bg-foreground/[0.055] disabled:text-muted-foreground"
      >
        <span className="size-4 shrink-0 rounded-full border border-border/80 bg-foreground/[0.04]" />
        <span className="min-w-0 truncate font-medium">{activeSession?.label ?? view.activeSessionLabel}</span>
      </button>
      <IconButton
        title={view.newSessionLabel}
        size="sm"
        onClick={view.onNewSession}
      >
        <Plus size={15} />
      </IconButton>
      {open ? (
        <div
          role="menu"
          className="absolute left-0 top-[calc(100%+0.35rem)] z-50 w-72 rounded-lg border border-border bg-popover p-1.5 shadow-lg"
        >
          {view.sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              role="menuitemradio"
              aria-checked={session.id === view.activeSessionId}
              onClick={() => {
                setOpen(false);
                view.onSelectSession(session.id);
              }}
              className="flex w-full min-w-0 flex-col rounded-md px-2.5 py-2 text-left text-xs leading-4 text-popover-foreground outline-none hover:bg-popover-accent focus:bg-popover-accent"
            >
              <span className="max-w-full truncate font-medium">{session.label}</span>
              <span className="max-w-full truncate text-muted-foreground">
                {[session.statusLabel, session.detail].filter(Boolean).join(" - ")}
              </span>
            </button>
          ))}
          {view.sessions.length ? (
            <div className="my-1 border-t border-border/60" aria-hidden />
          ) : null}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              view.onNewSession();
            }}
            className="flex w-full min-w-0 items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-medium leading-4 text-popover-foreground outline-none hover:bg-popover-accent focus:bg-popover-accent"
          >
            <Plus size={14} className="shrink-0" />
            <span className="min-w-0 truncate">{view.newSessionLabel}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
