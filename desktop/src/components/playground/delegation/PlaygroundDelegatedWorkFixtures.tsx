import type {
  CoworkComposerStripSummary,
  CoworkComposerWorkspaceRow,
} from "@/hooks/cowork/facade/use-cowork-composer-strip";
import { resolveSubagentColor } from "@/lib/domain/chat/subagents/subagent-braille-color";

export const PLAYGROUND_COWORK_ROWS: CoworkComposerWorkspaceRow[] = [
  {
    ownershipId: "workspace-frontend-polish",
    workspaceId: "workspace-frontend-polish",
    parentSessionId: "playground-root-session",
    label: "frontend-polish",
    sessionCount: 2,
    active: true,
    sessions: [
      {
        sessionLinkId: "coding-link-composer-layout",
        codingSessionId: "coding-session-composer-layout",
        parentSessionId: "playground-root-session",
        label: "composer layout cleanup",
        agentKind: "codex",
        statusLabel: "Working",
        meta: "Codex · gpt-5.4 · implementation",
        latestCompletionLabel: null,
        wakeScheduled: false,
        color: resolveSubagentColor("coding-link-composer-layout"),
        active: true,
      },
      {
        sessionLinkId: "coding-link-visual-regression",
        codingSessionId: "coding-session-visual-regression",
        parentSessionId: "playground-root-session",
        label: "visual regression pass",
        agentKind: "claude",
        statusLabel: "Idle",
        meta: "Claude · sonnet · verification",
        latestCompletionLabel: "Turn completed",
        wakeScheduled: true,
        color: resolveSubagentColor("coding-link-visual-regression"),
        active: false,
      },
    ],
  },
];

export const PLAYGROUND_COWORK_SUMMARY: CoworkComposerStripSummary = {
  label: "1 coding workspace",
  detail: "1 working · 1 wake scheduled",
  active: true,
};
