//! `WS /v1/feeds/{feed_id}` — lazy live content for an activity roster feed.
//
// A roster element (`ActivityProcess` / `ActivitySubagent`) carries an opaque
// `FeedRef { feedId, kind }`. Opening this socket materializes the feed's
// transport (file tail / child demux) runtime-side; bytes flow only while the
// socket is open. Frames are read-only, replayed on connect then streamed live.
// The client never learns the transport — only the opaque `feedId`.

import {
  TERMINAL_WEBSOCKET_BEARER_PROTOCOL,
  type TerminalWebSocketAuthTransport,
} from "./terminals.js";

export type FeedWebSocketAuthTransport = TerminalWebSocketAuthTransport;

export interface FeedBytesFrame {
  type: "bytes";
  feedId: string;
  dataBase64: string;
}

export interface FeedTextFrame {
  type: "text";
  feedId: string;
  text: string;
}

export type FeedFrame = FeedBytesFrame | FeedTextFrame;

export interface FeedStreamOptions {
  baseUrl: string;
  feedId: string;
  authToken?: string;
  webSocketAuthTransport?: FeedWebSocketAuthTransport;
  /** Terminal-bytes frames (base64-decoded). */
  onBytes?: (data: Uint8Array, frame: FeedBytesFrame) => void;
  /** Transcript/text frames. */
  onText?: (text: string, frame: FeedTextFrame) => void;
  onError?: (error: Event) => void;
  onOpen?: () => void;
  onClose?: (event: CloseEvent) => void;
}

export interface FeedStreamHandle {
  close: () => void;
}

export function connectFeed(options: FeedStreamOptions): FeedStreamHandle {
  const wsUrl = options.baseUrl.replace(/^http/, "ws").replace(/\/+$/, "");
  const params = new URLSearchParams();
  const useProtocolAuth = Boolean(
    options.authToken && options.webSocketAuthTransport === "protocol",
  );
  if (options.authToken && !useProtocolAuth) {
    params.set("access_token", options.authToken);
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  const url = `${wsUrl}/v1/feeds/${encodeURIComponent(options.feedId)}${suffix}`;

  const protocols = options.authToken && useProtocolAuth
    ? [TERMINAL_WEBSOCKET_BEARER_PROTOCOL, options.authToken]
    : undefined;
  const ws = protocols ? new WebSocket(url, protocols) : new WebSocket(url);
  ws.binaryType = "arraybuffer";

  ws.addEventListener("open", () => {
    options.onOpen?.();
  });

  ws.addEventListener("message", (event) => {
    if (typeof event.data !== "string") {
      return;
    }
    try {
      const frame = JSON.parse(event.data) as FeedFrame;
      if (frame.type === "bytes") {
        options.onBytes?.(decodeBase64(frame.dataBase64), frame);
      } else if (frame.type === "text") {
        options.onText?.(frame.text, frame);
      }
    } catch {
      options.onError?.(new Event("invalid-feed-frame"));
    }
  });

  ws.addEventListener("error", (event) => {
    options.onError?.(event);
  });

  ws.addEventListener("close", (event) => {
    options.onClose?.(event);
  });

  return {
    close() {
      ws.close();
    },
  };
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
