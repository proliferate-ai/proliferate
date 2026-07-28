import { PlanMarkdownBody } from "@proliferate/ui";

const PROPOSED_PLAN = [
  "## Fix the sandbox idle-timeout reaper",
  "",
  "Idle cloud sandboxes are reaped 90s after the last websocket frame, which",
  "kills sessions that are only waiting on a long `cargo build`.",
  "",
  "### Steps",
  "",
  "1. Move the idle clock from frame arrival to `last_activity_at` on the run.",
  "2. Have `proliferate-worker` heartbeat while any child process is running.",
  "3. Raise the grace window to 10 minutes and make it profile-configurable.",
  "4. Backfill `last_activity_at` for live runs before the deploy.",
  "",
  "### Risks",
  "",
  "- A wedged child process now holds a sandbox open indefinitely.",
  "- The backfill touches `runs` while the reaper is live.",
].join("\n");

const PLAN_WITH_TASKS = [
  "## Ship the design-sync preview cards",
  "",
  "### Checklist",
  "",
  "- [x] Author previews for the wave-1 primitives",
  "- [x] Fold batch learnings into `NOTES.md`",
  "- [ ] Author the product-surface previews (wave 2)",
  "- [ ] Re-capture and grade every sheet",
  "",
  "Blocked on nothing — the bundle already exports all 374 names.",
].join("\n");

const DEFAULT_PLAN = [
  "# Migrate the transcript to token-based highlighting",
  "",
  "Replace the `dangerouslySetInnerHTML` HTML path with `HighlightedToken[][]`",
  "so search marks can be injected per token instead of re-parsing strings.",
  "",
  "1. Land `CodeTokenLine` + `CodeBlockTokenContent` behind the existing shell.",
  "2. Switch `renderTranscriptCodeBlock` to `useHighlightedTokens`.",
  "3. Delete `useHighlightedCode` and its cache once nothing imports it.",
  "",
  "The shell (`MarkdownCodeBlockShell`) keeps its copy payload throughout, so",
  "`code` stays the plain-text fallback at every step.",
].join("\n");

export const ProposedPlan = () => (
  <div className="w-full max-w-2xl">
    <PlanMarkdownBody content={PROPOSED_PLAN} presentation="proposal" />
  </div>
);

export const ProposalTaskList = () => (
  <div className="w-full max-w-2xl">
    <PlanMarkdownBody content={PLAN_WITH_TASKS} presentation="proposal" />
  </div>
);

export const DefaultPresentation = () => (
  <div className="w-full max-w-2xl">
    <PlanMarkdownBody content={DEFAULT_PLAN} className="text-message" />
  </div>
);
