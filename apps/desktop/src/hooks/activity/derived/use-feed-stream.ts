import { useEffect, useState } from "react";
import { connectFeed, type FeedStreamHandle } from "@anyharness/sdk";
import type { FeedRefWire } from "@proliferate/product-domain/activity/process";
import { useTerminalWorkspaceConnection } from "@/hooks/terminals/workflows/use-terminal-workspace-connection";

export interface FeedStreamState {
  /** Accumulated feed content (terminal bytes decoded as UTF-8, or text lines). */
  content: string;
  connected: boolean;
  error: string | null;
}

const IDLE: FeedStreamState = { content: "", connected: false, error: null };

/**
 * Consumes an activity roster element's lazy content feed over
 * `WS /v1/feeds/{feedId}`. Bytes flow only while `enabled` and the socket is
 * open — a closed panel costs nothing (the runtime tears the transport down on
 * disconnect). The transport (file tail / child demux) stays opaque: we only
 * ever hold the `feedId` from the `FeedRef`.
 */
export function useFeedStream(
  feed: FeedRefWire | null,
  options: { workspaceId: string | null; enabled: boolean },
): FeedStreamState {
  const { workspaceId, enabled } = options;
  const { resolveTerminalWorkspaceConnection } = useTerminalWorkspaceConnection();
  const [state, setState] = useState<FeedStreamState>(IDLE);
  const feedId = feed?.feedId ?? null;

  useEffect(() => {
    if (!feedId || !enabled || !workspaceId) {
      setState(IDLE);
      return;
    }

    let cancelled = false;
    let handle: FeedStreamHandle | null = null;
    const decoder = new TextDecoder();
    setState(IDLE);

    void (async () => {
      try {
        const connection = await resolveTerminalWorkspaceConnection(workspaceId);
        if (cancelled) {
          return;
        }
        handle = connectFeed({
          baseUrl: connection.runtimeUrl,
          feedId,
          authToken: connection.authToken,
          webSocketAuthTransport: connection.webSocketAuthTransport,
          onOpen: () => {
            if (!cancelled) {
              setState((prev) => ({ ...prev, connected: true, error: null }));
            }
          },
          onBytes: (bytes) => {
            if (!cancelled) {
              const chunk = decoder.decode(bytes, { stream: true });
              setState((prev) => ({ ...prev, content: prev.content + chunk }));
            }
          },
          onText: (text) => {
            if (!cancelled) {
              setState((prev) => ({ ...prev, content: `${prev.content}${text}\n` }));
            }
          },
          onError: () => {
            if (!cancelled) {
              setState((prev) => ({ ...prev, error: "Feed stream error" }));
            }
          },
          onClose: () => {
            if (!cancelled) {
              setState((prev) => ({ ...prev, connected: false }));
            }
          },
        });
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error);
          setState((prev) => ({ ...prev, error: message }));
        }
      }
    })();

    return () => {
      cancelled = true;
      handle?.close();
    };
  }, [feedId, enabled, workspaceId, resolveTerminalWorkspaceConnection]);

  return state;
}
