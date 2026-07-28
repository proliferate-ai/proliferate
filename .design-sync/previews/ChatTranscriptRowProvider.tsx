import type { ReactNode } from "react";
import {
  AssistantMessage,
  ChatContentSearchQueryContext,
  ChatTranscriptRowProvider,
} from "@proliferate/ui";

/**
 * ChatTranscriptRowProvider has no visual of its own — it is the per-row half
 * of the chat content-search paint layer. It is therefore always composed here
 * around the prose it enables: the transcript root supplies the active query,
 * this provider supplies the row identity, and MarkdownBody paints
 * <mark class="codex-thread-find-match"> only when BOTH are present.
 */

const ROW_TEXT = `The capture harness drives one story per page load, so a portalled
overlay lands centred on the capture viewport. That is why an overlay
component needs no card override to photograph — the override only matters
for the product's default grid render, where every story mounts at once.`;

const ThreadColumn = ({ children }: { children: ReactNode }) => (
  <div className="w-full max-w-2xl">
    <div className="mb-3 flex items-center justify-between rounded-lg border border-border bg-surface-elevated px-3 py-2 text-ui-sm">
      <span className="text-muted-foreground">Find in chat</span>
      <span className="font-mono text-foreground">overlay</span>
    </div>
    {children}
  </div>
);

/** Search open + row identity present → matches are painted. */
export const PaintedMatches = () => (
  <ThreadColumn>
    <ChatContentSearchQueryContext.Provider value="overlay">
      <ChatTranscriptRowProvider value={{ rowUnitId: "chatrow:turn-8:content", rowIndex: 8 }}>
        <AssistantMessage content={ROW_TEXT} />
      </ChatTranscriptRowProvider>
    </ChatContentSearchQueryContext.Provider>
  </ThreadColumn>
);

/**
 * Same row, same query, but the row provider is missing: the paint hook
 * resolves to null and the prose renders unmarked. This is the failure mode
 * the provider exists to prevent.
 */
export const WithoutRowIdentity = () => (
  <ThreadColumn>
    <ChatContentSearchQueryContext.Provider value="overlay">
      <AssistantMessage content={ROW_TEXT} />
    </ChatContentSearchQueryContext.Provider>
  </ThreadColumn>
);

/** Search closed: the provider is mounted but inert — zero work, no marks. */
export const SearchClosed = () => (
  <div className="w-full max-w-2xl">
    <ChatTranscriptRowProvider value={{ rowUnitId: "chatrow:turn-8:content", rowIndex: 8 }}>
      <AssistantMessage content={ROW_TEXT} />
    </ChatTranscriptRowProvider>
  </div>
);

/** Several consecutive rows, each with its own stable unit id. */
export const StackedRows = () => (
  <div className="flex w-full max-w-2xl flex-col gap-5">
    <ChatContentSearchQueryContext.Provider value="capture">
      <ChatTranscriptRowProvider value={{ rowUnitId: "chatrow:turn-7:content", rowIndex: 7 }}>
        <AssistantMessage content="The capture harness loads each story at 900x700 with `fullPage:false`." />
      </ChatTranscriptRowProvider>
      <ChatTranscriptRowProvider value={{ rowUnitId: "chatrow:turn-8:content", rowIndex: 8 }}>
        <AssistantMessage content="A second capture pass re-uses the cached grade unless the contract key changed." />
      </ChatTranscriptRowProvider>
    </ChatContentSearchQueryContext.Provider>
  </div>
);
