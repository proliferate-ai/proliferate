import { createContext, useContext, type ReactNode } from "react";

/**
 * Content-search paint layer (Cmd+F in chat). Two contexts feed the prose
 * highlighter in MarkdownBody:
 *
 *  - the active normalized query (null when search is closed / not the chat
 *    surface — the disabled fast path), provided once at the transcript root;
 *  - the enclosing transcript row's stable unit id + index, provided per row.
 *
 * Highlighting is deliberately best-effort: match COUNTS and navigation come
 * from a separate data-level index (see the desktop
 * use-chat-transcript-content-search hook), so painting only decorates what it
 * can reach. Everything here is inert (context null → zero work) when search is
 * closed. See specs/codebase/features/content-search.md.
 */

export const ChatContentSearchQueryContext = createContext<string | null>(null);

export interface ChatTranscriptRowContextValue {
  rowUnitId: string;
  rowIndex: number;
}

export const ChatTranscriptRowContext = createContext<ChatTranscriptRowContextValue | null>(
  null,
);

export function useChatTranscriptRow(): ChatTranscriptRowContextValue | null {
  return useContext(ChatTranscriptRowContext);
}

export interface ChatContentSearchPaint {
  query: string;
  rowUnitId: string;
}

/** Resolves the paint target for the current row, or null when inert. */
export function useChatContentSearchPaint(): ChatContentSearchPaint | null {
  const query = useContext(ChatContentSearchQueryContext);
  const row = useContext(ChatTranscriptRowContext);
  if (!query || !row) {
    return null;
  }
  return { query, rowUnitId: row.rowUnitId };
}

export function ChatTranscriptRowProvider({
  value,
  children,
}: {
  value: ChatTranscriptRowContextValue;
  children: ReactNode;
}) {
  return (
    <ChatTranscriptRowContext.Provider value={value}>
      {children}
    </ChatTranscriptRowContext.Provider>
  );
}
