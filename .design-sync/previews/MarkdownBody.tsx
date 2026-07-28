import { MarkdownBody } from "@proliferate/ui";

const ASSISTANT_ANSWER = [
  "### Why the transcript remounts while streaming",
  "",
  "`MarkdownBody` builds its `components` map on every render, and a fresh",
  "arrow function is a **new element type** — so React unmounts and remounts",
  "the whole markdown DOM. That is the jump you see mid-stream.",
  "",
  "1. Hoist the static overrides into `STATIC_MARKDOWN_COMPONENTS`.",
  "2. Memoize the per-call slots (`renderLink`, `renderCodeBlock`).",
  "3. Keep the exported `MarkdownBody` wrapped in `memo`.",
  "",
  "```tsx",
  "const components = useMemo(() => ({",
  "  ...STATIC_MARKDOWN_COMPONENTS,",
  "  a: createMarkdownAnchor(renderLink),",
  "}), [renderLink]);",
  "```",
  "",
  "> Referential stability is the whole fix — see the identity note above",
  "> `STATIC_MARKDOWN_COMPONENTS` in the source.",
].join("\n");

const REVIEW_NOTES = [
  "#### Review checklist — `claude/design-sync-ui-import`",
  "",
  "- [x] `pnpm -F \"@proliferate/product-ui...\" build` passes",
  "- [x] Token authority untouched (`theme.css` diff is empty)",
  "- [ ] Screenshot the goal bar at every Appearance preset",
  "- [ ] Re-run `cargo test -p anyharness-core` after the rebase",
  "",
  "Blocking discussion is on",
  "[proliferate-ai/proliferate#805](https://github.com/proliferate-ai/proliferate/pull/805).",
].join("\n");

const TOOL_DETAIL = [
  "Ran `rg -n \"deriveGoalBarState\" apps/packages` and found **3** call sites:",
  "",
  "- `product-ui/src/activity/GoalBar.tsx` — derives the bar state per render",
  "- `product-ui/src/activity/GoalBar.test.tsx` — status matrix",
  "- `product-domain/src/activity/goal.ts` — the derivation itself",
  "",
  "Nothing outside `activity/` reads it, so the *paused* phase can move into",
  "`goalStatusTone` without touching the transcript rows.",
].join("\n");

const STREAMING_TAIL = [
  "Rebased onto `main` and re-ran the transcript suite. Two failures left, both",
  "in `useTranscriptStickToBottom`:",
  "",
  "1. `keeps the viewport pinned when a row grows after commit`",
  "2. `releases the pin once the user scrolls up past the threshold`",
  "",
  "The first one is a `ResizeObserver` ordering problem — the observer fires",
  "before the layout effect re-reads `scrollHeight`, so the pin lands on the",
  "stale height. The fix goes in",
  "[useTranscriptStickToBottom.ts](./apps/packages/product-ui/src/chat/transc",
].join("\n");

export const AssistantAnswer = () => (
  <div className="w-full max-w-2xl">
    <MarkdownBody content={ASSISTANT_ANSWER} className="text-message" />
  </div>
);

export const TaskListGrid = () => (
  <div className="w-full max-w-2xl">
    <MarkdownBody content={REVIEW_NOTES} taskListItems="grid" className="text-message" />
  </div>
);

export const ToolDetailBody = () => (
  <div className="w-full max-w-2xl">
    <MarkdownBody content={TOOL_DETAIL} className="text-chat" />
  </div>
);

export const StreamingTail = () => (
  <div className="w-full max-w-2xl">
    <MarkdownBody content={STREAMING_TAIL} isStreaming className="text-message" />
  </div>
);
