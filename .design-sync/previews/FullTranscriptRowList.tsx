import { useRef, type ReactNode } from "react";
import {
  AssistantMessage,
  CopyMessageButton,
  FullTranscriptRowList,
} from "@proliferate/ui";

const noop = () => {};

// FullTranscriptRowList is the non-virtualized scroll shell: `h-full` over an
// AutoHideScrollArea. With no bounded parent it collapses to zero height, so
// every cell gives it the chat pane's box.
const Pane = ({ children }: { children: ReactNode }) => (
  <div
    className="w-full max-w-3xl overflow-hidden rounded-xl border border-border bg-background"
    style={{ height: 600 }}
  >
    {children}
  </div>
);

const ASSISTANT_ONE = [
  "The remount comes from `MarkdownBody` rebuilding its `components` map on",
  "every render — a fresh arrow function is a new element type, so React tears",
  "down the whole markdown DOM.",
  "",
  "1. Hoist the static overrides into `STATIC_MARKDOWN_COMPONENTS`.",
  "2. Memoize the per-call slots.",
].join("\n");

const ASSISTANT_TWO = [
  "Landed. `resolveTranscriptBottomInsets` now splits the inset so the overlay",
  "half never displaces content:",
  "",
  "```ts",
  "const total = Math.max(0, bottomInsetPx);",
  "const nonDisplacing = Math.min(total, Math.max(0, nonDisplacingBottomInsetPx));",
  "return { structural: total - nonDisplacing, nonDisplacing };",
  "```",
  "",
  "Both stick-to-bottom tests pass on `main`.",
].join("\n");

type Row = { key: string; role: "user" | "assistant"; content: string; at: string };

const ROWS: Row[] = [
  {
    key: "turn:t1:block:content",
    role: "user",
    content: "Why does the transcript jump to the top mid-stream?",
    at: "2:11 PM",
  },
  {
    key: "turn:t2:block:content",
    role: "assistant",
    content: ASSISTANT_ONE,
    at: "2:12 PM",
  },
  {
    key: "turn:t3:block:content",
    role: "user",
    content: "Do that, then re-run the stick-to-bottom suite.",
    at: "2:13 PM",
  },
  {
    key: "turn:t4:block:content",
    role: "assistant",
    content: ASSISTANT_TWO,
    at: "2:14 PM",
  },
];

function renderRow(row: Row): ReactNode {
  if (row.role === "user") {
    return (
      <div className="flex justify-end py-3">
        <div
          className="break-words rounded-2xl bg-foreground/5 px-3 py-2 text-message text-foreground"
          style={{ maxWidth: "77%" }}
        >
          {row.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 py-3">
      <AssistantMessage content={row.content} animateReveal={false} />
      <div className="flex items-center gap-2 text-chat">
        <CopyMessageButton
          content={row.content}
          timestampLabel={row.at}
          timestampPosition="after"
          visibilityClassName="opacity-100"
        />
      </div>
    </div>
  );
}

const BASE = {
  fallbackReason: null,
  virtualizationMode: "off" as const,
  hasOlderHistory: false,
  isLoadingOlderHistory: false,
  olderHistoryCursor: null,
  bottomInsetPx: 24,
  selectedWorkspaceId: "ws_proliferate",
  activeSessionId: "sess_8f21",
  isSessionBusy: false,
  pendingPromptText: null,
  onLoadOlderHistory: noop,
  onScrollSample: noop,
  renderRow,
};

export const Thread = () => {
  const selectionRootRef = useRef<HTMLDivElement>(null);
  return (
    <Pane>
      <FullTranscriptRowList {...BASE} rows={ROWS} selectionRootRef={selectionRootRef} />
    </Pane>
  );
};

export const LoadingOlderHistory = () => {
  const selectionRootRef = useRef<HTMLDivElement>(null);
  return (
    <Pane>
      <FullTranscriptRowList
        {...BASE}
        rows={ROWS.slice(1)}
        hasOlderHistory
        isLoadingOlderHistory
        olderHistoryCursor={40}
        selectionRootRef={selectionRootRef}
      />
    </Pane>
  );
};

export const SingleTurn = () => {
  const selectionRootRef = useRef<HTMLDivElement>(null);
  return (
    <Pane>
      <FullTranscriptRowList
        {...BASE}
        rows={ROWS.slice(0, 2)}
        bottomInsetPx={72}
        nonDisplacingBottomInsetPx={48}
        selectionRootRef={selectionRootRef}
      />
    </Pane>
  );
};
