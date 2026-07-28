import type { ReactNode } from "react";
import { AgentsRosterPanel, ComposerPopoverSurface } from "@proliferate/ui";

const NOW_MS = 1_751_450_100_000;

const subagent = (overrides: Record<string, unknown>) => ({
  id: "task-1",
  agentType: "general-purpose",
  description: "API surface check",
  model: "claude-opus-4",
  background: true,
  status: { status: "running" },
  usage: null,
  feed: { feedId: "feed-task-1", kind: "transcript" },
  ...overrides,
});

/** The ⑂ chip's popover surface — the panel's only real host. */
const PanelSurface = ({ children }: { children: ReactNode }) => (
  <ComposerPopoverSurface className="w-80 p-1.5">{children}</ComposerPopoverSurface>
);

export const RunningSubagents = () => (
  <PanelSurface>
    <AgentsRosterPanel
      nowMs={NOW_MS}
      agents={[
        subagent({
          id: "task-1",
          description: "Audit the cloud-environment API surface",
          model: "claude-opus-4",
          usage: { tokensUsed: 62_800, toolCalls: 24, durationSeconds: 420 },
        }),
        subagent({
          id: "task-2",
          description: "Docs pass over the new auth flow",
          model: "claude-sonnet-4",
          background: false,
          usage: { tokensUsed: 41_200, toolCalls: 18, durationSeconds: 210 },
        }),
        subagent({
          id: "task-3",
          description: "Triage the flaky live-session tests",
          model: "claude-haiku-4",
          usage: { tokensUsed: 8_400, toolCalls: 5, durationSeconds: 40 },
        }),
      ]}
    />
  </PanelSurface>
);

export const SingleAgent = () => (
  <PanelSurface>
    <AgentsRosterPanel
      nowMs={NOW_MS}
      agents={[
        subagent({
          id: "task-9",
          description: "Port the playground registry into design-sync previews",
          model: "claude-opus-4",
          background: false,
          usage: { tokensUsed: 15_600, toolCalls: 9, durationSeconds: 95 },
        }),
      ]}
    />
  </PanelSurface>
);

/**
 * Finished subagents leave the roster the instant they complete, so a roster
 * holding only completed/failed work renders the empty copy.
 */
export const NoActiveSubagents = () => (
  <PanelSurface>
    <AgentsRosterPanel
      nowMs={NOW_MS}
      agents={[
        subagent({
          id: "task-4",
          description: "Docs pass over the new auth flow",
          status: { status: "completed", summary: "Updated 3 docs pages." },
        }),
        subagent({ id: "task-5", description: "Flaky test triage", status: { status: "failed" } }),
      ]}
    />
  </PanelSurface>
);
