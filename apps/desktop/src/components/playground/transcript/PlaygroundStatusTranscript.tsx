import { useEffect, useState, type ReactNode } from "react";
import { CircleAlert } from "@proliferate/ui/icons";
import type { GoalTranscriptEvent } from "@proliferate/product-domain/activity/goal-transcript-events";
import { AssistantMessage } from "@/components/workspace/chat/transcript/AssistantMessage";
import { GoalTranscriptEventRow } from "@/components/workspace/chat/transcript/GoalTranscriptEventRow";
import { StreamingIndicator } from "@/components/workspace/chat/transcript/StreamingIndicator";
import { PendingInteractionMarkerView } from "@/components/workspace/chat/transcript/TranscriptTurnChrome";
import type { ScenarioKey } from "@/config/playground";
import {
  HookPreview,
  TranscriptPreviewShell,
  TransientStatusRow,
} from "@/components/playground/transcript/PlaygroundTranscriptShell";

export function renderPlaygroundStatusTranscript(scenario: ScenarioKey): ReactNode | null {
  switch (scenario) {
    case "status-background":
      return (
        <TranscriptPreviewShell>
          <AssistantMessage content="I’ll connect the MCP server and continue once authentication is ready." />
          <TransientStatusRow text="Authenticating MCP Google… follow the browser prompt if it appears." />
        </TranscriptPreviewShell>
      );
    case "status-live-stream":
      return (
        <TranscriptPreviewShell>
          <LiveStreamPreview />
        </TranscriptPreviewShell>
      );
    case "status-hook-running":
      return (
        <TranscriptPreviewShell>
          <HookPreview status="running" title="Hook: Pre Tool Use" body="checking output policy" />
          <StreamingIndicator startedAt={new Date(Date.now() - 7_000).toISOString()} />
        </TranscriptPreviewShell>
      );
    case "status-hook-completed":
      return (
        <TranscriptPreviewShell>
          <HookPreview status="completed" title="Hook: Post Tool Use" body="Feedback: formatted command output" />
        </TranscriptPreviewShell>
      );
    case "status-hook-blocked":
      return (
        <TranscriptPreviewShell>
          <HookPreview status="failed" title="Hook: Stop" body="Stop: tests must pass before ending the turn" />
        </TranscriptPreviewShell>
      );
    case "status-deprecation":
      return (
        <TranscriptPreviewShell>
          <WarningNotice
            title="Deprecated instructions file detected"
            body="Move these instructions into AGENTS.md so future Codex sessions load them consistently."
          />
        </TranscriptPreviewShell>
      );
    case "status-assistant-handoff":
      return (
        <TranscriptPreviewShell>
          <AssistantMessage
            content="I found the relevant files and I’m going to inspect the runtime path next."
            isStreaming={false}
          />
          <StreamingIndicator startedAt={new Date(Date.now() - 18_000).toISOString()} />
        </TranscriptPreviewShell>
      );
    // Two-part pending-interaction pattern: the typed transcript marker below
    // pairs with the docked card rendered for the same scenario key by
    // PlaygroundPanelSlotFixtures.
    case "interaction-marker-permission":
      return (
        <TranscriptPreviewShell>
          <AssistantMessage content="The branch is ready — I need to push it before opening the PR." />
          <PendingInteractionMarkerView kind="permission" />
        </TranscriptPreviewShell>
      );
    case "interaction-marker-question":
      return (
        <TranscriptPreviewShell>
          <AssistantMessage content="Two providers can back this integration; the choice decides which auth flow I wire up." />
          <PendingInteractionMarkerView kind="question" />
        </TranscriptPreviewShell>
      );
    case "grok-retry-status":
      return (
        <TranscriptPreviewShell>
          <AssistantMessage content="I started drafting the change, but the model stream was interrupted mid-sentence" />
          <TransientStatusRow text="Retrying Grok request..." />
          <AssistantMessage content="Retry finished with a fresh attempt. I’ll continue from the recovered response." />
        </TranscriptPreviewShell>
      );
    case "grok-blocked-warning":
      return (
        <TranscriptPreviewShell>
          <WarningNotice
            title="Grok agent execution blocked"
            body="A policy hook blocked the requested action. The warning remains in the transcript after the turn ends."
          />
        </TranscriptPreviewShell>
      );
    case "grok-no-response-warning":
      return (
        <TranscriptPreviewShell>
          <WarningNotice
            title="Grok ended without a valid response"
            body="The adapter reports the invalid stream as visible transcript text instead of leaving the turn looking frozen."
          />
        </TranscriptPreviewShell>
      );
    case "opencode-mcp-approval-options":
      return (
        <TranscriptPreviewShell>
          <AssistantMessage content="OpenCode needs permission before calling the GitHub MCP search tool." />
          <TransientStatusRow text="Waiting for exact MCP permission option selection." />
        </TranscriptPreviewShell>
      );
    case "opencode-tool-before-approval":
      return (
        <TranscriptPreviewShell>
          <HookPreview
            status="running"
            name="MCP tool"
            title="MCP: github.search_pull_requests"
            body={'{\n  "query": "is:pr repo:proliferate-ai/proliferate interactions"\n}'}
          />
          <TransientStatusRow text="Awaiting permission to run this MCP tool." />
        </TranscriptPreviewShell>
      );
    // Goal lifecycle rows are client-side composition (deriveGoalTranscriptEvents)
    // interleaved into the real transcript by seq; this preview hardcodes the
    // set -> edited -> met sequence around static assistant turns instead of
    // driving the full row model, matching this file's other static previews.
    case "goal-transcript-lifecycle":
      return (
        <TranscriptPreviewShell>
          <GoalTranscriptEventRow event={GOAL_TRANSCRIPT_EVENT_SET} />
          <AssistantMessage content={'Setting a goal so I can track this end-to-end: DONE.txt exists in the repo root and contains exactly "done".'} />
          <AssistantMessage content="First pass didn't quite match the acceptance check — narrowing the objective to the exact contents." />
          <GoalTranscriptEventRow event={GOAL_TRANSCRIPT_EVENT_EDITED} />
          <AssistantMessage content="DONE.txt now exists with the exact contents the goal expects." />
          <GoalTranscriptEventRow event={GOAL_TRANSCRIPT_EVENT_MET} />
        </TranscriptPreviewShell>
      );
    default:
      return null;
  }
}

const GOAL_TRANSCRIPT_EVENT_SET: GoalTranscriptEvent = {
  id: "1",
  seq: 1,
  turnId: null,
  kind: "set",
  objective: "DONE.txt exists in the repo root and contains exactly \"done\"",
  detail: null,
};

const GOAL_TRANSCRIPT_EVENT_EDITED: GoalTranscriptEvent = {
  id: "2",
  seq: 8,
  turnId: "turn-1",
  kind: "edited",
  objective: "DONE.txt exists in the repo root and contains exactly \"done\" (trailing newline optional)",
  detail: null,
};

const GOAL_TRANSCRIPT_EVENT_MET: GoalTranscriptEvent = {
  id: "3",
  seq: 15,
  turnId: "turn-2",
  kind: "met",
  objective: "DONE.txt exists in the repo root and contains exactly \"done\" (trailing newline optional)",
  detail: "DONE.txt exists in the repo root and its contents are exactly \"done\"",
};

const LIVE_STREAM_TEXT = `Totally. I'll re-ground this with actual repo checks rather than just memory, and then I'll give you the distilled version with the parts that matter for the design.

The plan splits into three phases:

- **Discovery** — sweep the workspace flow entry points and map which stores own which lifecycle state.
- **Reconciliation** — validate the optimistic session against the loaded list before landing.
- **Polish** — make streaming, scroll, and trailing status behave like one continuous surface.

A couple of useful confirmations: the worktree is detached with unrelated local changes, and the repo already has a model-catalog spec that uses the same language we landed on. I'm checking that exact spec section next to make sure the productized probe concept lines up with what the runtime already does today.`;

// Deterministic streaming fixture: replays LIVE_STREAM_TEXT in small timed
// deltas, then holds an in-progress trailing status, so the reveal animation
// and the prose→status handoff are verifiable without a real session.
function LiveStreamPreview() {
  const [visibleLength, setVisibleLength] = useState(0);
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    setVisibleLength(0);
    const interval = window.setInterval(() => {
      setVisibleLength((current) => {
        if (current >= LIVE_STREAM_TEXT.length) {
          return current;
        }
        return Math.min(LIVE_STREAM_TEXT.length, current + 12 + Math.floor(Math.random() * 60));
      });
    }, 120);
    const restart = window.setTimeout(() => setCycle((value) => value + 1), 30_000);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(restart);
    };
  }, [cycle]);

  const content = LIVE_STREAM_TEXT.slice(0, visibleLength);
  const isStreaming = visibleLength < LIVE_STREAM_TEXT.length;
  return (
    <>
      {content && <AssistantMessage content={content} isStreaming={isStreaming} />}
      {!isStreaming && (
        <TransientStatusRow text="Reading workspace flow entry points" />
      )}
    </>
  );
}

function WarningNotice({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-warning/35 bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
      <div className="flex items-center gap-2 font-medium">
        <CircleAlert className="size-3.5" />
        <span>{title}</span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {body}
      </p>
    </div>
  );
}
