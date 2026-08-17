import { ArrowLeft } from "#product/primitives/icons/core";
import { Terminal as TerminalIcon } from "#product/primitives/icons/workspace";
import { PaneIconButton } from "#product/primitives/PaneIconButton";
import { AutoHideScrollArea } from "#product/primitives/patterns/AutoHideScrollArea";
import type { ActivityProcessWire, FeedRefWire } from "#product/domain/activity/process";
import { useActiveSessionId } from "#product/hooks/chat/derived/use-active-session-identity";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useFeedStream } from "#product/hooks/activity/derived/use-feed-stream";

export interface BackgroundTerminalViewProps {
  process: ActivityProcessWire;
  feed: FeedRefWire | null;
  onBack: () => void;
}

/**
 * Read-only detail view for one background process (Design Handoff — NEW
 * `BackgroundTerminalView`; Delivery Spec — Background Work Slice 1, rung
 * R3). Header on `TerminalTopBar`'s bar grammar (back + terminal glyph +
 * title only); body on `TerminalPanel`'s viewport shell, rendering the shell
 * prompt line, the command exactly as run, then the feed's bytes.
 *
 * Explicitly not a terminal: no status strip, no badges, no
 * `TerminalCommandFloatingAction`, no xterm, no input/resize/kill
 * affordance of any kind — this mirrors the agent's own output, it does not
 * let the reader steer it.
 *
 * Bytes stream only while this view is mounted: `useFeedStream` is lazy
 * (connects on mount, tears the socket down on unmount) and the pane only
 * ever mounts this component while its own selection points at this
 * process, so there is no separate "enabled" flag to thread through the
 * frozen `process` / `feed` / `onBack` prop contract.
 */
export function BackgroundTerminalView({ process, feed, onBack }: BackgroundTerminalViewProps) {
  const activeSessionId = useActiveSessionId();
  const workspaceId = useSessionDirectoryStore((state) =>
    activeSessionId ? state.entriesById[activeSessionId]?.workspaceId ?? null : null,
  );
  const { content, connected, error } = useFeedStream(feed, {
    workspaceId,
    enabled: feed !== null,
  });

  const bodyText = content || (feed ? (error ?? (connected ? "" : "Connecting…")) : "");

  return (
    <section
      aria-label="Background work — terminal detail"
      data-background-terminal-view=""
      data-process-id={process.id}
      className="flex h-full min-h-0 flex-col"
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-sidebar px-2 text-sidebar-foreground">
        <PaneIconButton label="Back to background work" onClick={onBack}>
          <ArrowLeft className="icon-compact" />
        </PaneIconButton>
        <TerminalIcon
          className="icon-paired shrink-0 [font-size:var(--text-sidebar-row)]"
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-ui font-medium" title={process.command}>
          {process.command}
        </span>
      </header>
      <AutoHideScrollArea className="min-h-0 w-full flex-1 bg-sidebar" viewportClassName="p-3">
        <pre
          className="m-0 whitespace-pre-wrap font-mono text-readable-code text-sidebar-foreground"
          data-telemetry-mask
        >
          <span className="text-sidebar-muted-foreground">$ </span>
          <span>{process.command}</span>
          {"\n"}
          {bodyText}
        </pre>
      </AutoHideScrollArea>
      <footer className="border-t border-border px-3 py-2 text-ui-sm text-muted-foreground">
        Read-only mirror of the agent's own output. No input, no resize, no kill.
      </footer>
    </section>
  );
}
