import type {
  CoworkComposerStripSummary,
  CoworkComposerWorkspaceRow,
} from "@/hooks/cowork/facade/use-cowork-composer-strip";
import { buildDelegatedAgentIdentity } from "@/lib/domain/delegated-work/identity";

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
        identity: buildDelegatedAgentIdentity({
          id: "coding-link-composer-layout",
          title: "composer layout cleanup",
          workspaceId: "workspace-frontend-polish",
          sessionId: "coding-session-composer-layout",
          sessionLinkId: "coding-link-composer-layout",
        }),
        agentKind: "codex",
        statusLabel: "Working",
        statusCategory: "running",
        meta: "Codex · gpt-5.4 · implementation",
        latestCompletionLabel: null,
        wakeScheduled: false,
        active: true,
      },
      {
        sessionLinkId: "coding-link-visual-regression",
        codingSessionId: "coding-session-visual-regression",
        parentSessionId: "playground-root-session",
        label: "visual regression pass",
        identity: buildDelegatedAgentIdentity({
          id: "coding-link-visual-regression",
          title: "visual regression pass",
          workspaceId: "workspace-frontend-polish",
          sessionId: "coding-session-visual-regression",
          sessionLinkId: "coding-link-visual-regression",
        }),
        agentKind: "claude",
        statusLabel: "Idle",
        statusCategory: "wake_scheduled",
        meta: "Claude · sonnet · verification",
        latestCompletionLabel: "Turn completed",
        wakeScheduled: true,
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
