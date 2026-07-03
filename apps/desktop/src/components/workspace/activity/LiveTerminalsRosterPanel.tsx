import { useCallback, useState } from "react";
import {
  sortProcessesForDisplay,
  type ActivityProcessWire,
} from "@proliferate/product-domain/activity/process";
import { TerminalRosterRow } from "@proliferate/product-ui/activity/TerminalRosterRow";
import { useActiveSessionId } from "@/hooks/chat/derived/use-active-session-identity";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useFeedStream } from "@/hooks/activity/derived/use-feed-stream";

export interface LiveTerminalsRosterPanelProps {
  processes: ActivityProcessWire[];
  nowMs: number;
}

/**
 * The ▸ chip's click-in panel, live-wired: read-only agent-spawned background
 * processes with a click-to-expand live tail sourced from each row's opaque
 * `FeedRef` over `WS /v1/feeds/{feedId}`. Bytes flow only while a row is
 * expanded (lazy FeedService semantics). Presentation of the row header stays
 * in the shared `TerminalRosterRow`; this desktop wrapper owns the SDK feed
 * wiring and expansion state.
 */
export function LiveTerminalsRosterPanel({ processes, nowMs }: LiveTerminalsRosterPanelProps) {
  const activeSessionId = useActiveSessionId();
  const workspaceId = useSessionDirectoryStore((state) =>
    activeSessionId ? state.entriesById[activeSessionId]?.workspaceId ?? null : null,
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const toggle = useCallback((processId: string) => {
    setExpandedId((current) => (current === processId ? null : processId));
  }, []);

  const sorted = sortProcessesForDisplay(processes);
  return (
    <div className="flex flex-col gap-1.5" data-terminals-roster-panel>
      <div className="px-1 pt-0.5">
        <span className="text-xs font-medium text-foreground">Terminals</span>
      </div>
      {sorted.length === 0 ? (
        <p className="px-1 pb-1 text-xs text-muted-foreground">No background terminals.</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {sorted.map((process) => (
            <li key={process.id}>
              <LiveTerminalRow
                process={process}
                nowMs={nowMs}
                workspaceId={workspaceId}
                expanded={expandedId === process.id}
                onToggle={toggle}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface LiveTerminalRowProps {
  process: ActivityProcessWire;
  nowMs: number;
  workspaceId: string | null;
  expanded: boolean;
  onToggle: (processId: string) => void;
}

function LiveTerminalRow({ process, nowMs, workspaceId, expanded, onToggle }: LiveTerminalRowProps) {
  const feed = process.feed;
  const { content, connected, error } = useFeedStream(feed, {
    workspaceId,
    enabled: expanded && feed !== null,
  });

  return (
    <div>
      <TerminalRosterRow
        process={process}
        nowMs={nowMs}
        onOpen={feed ? onToggle : undefined}
      />
      {expanded && feed && (
        <pre
          className="mx-1.5 mb-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 px-2 py-1.5 font-mono text-[11px] leading-snug text-muted-foreground"
          data-terminal-feed
          data-telemetry-mask
        >
          {content || (error ?? (connected ? "Waiting for output…" : "Connecting…"))}
        </pre>
      )}
    </div>
  );
}
