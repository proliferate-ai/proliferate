import type { WorkspaceStatusModel } from "#product/components/workspace/chat/input/workspace-status/WorkspaceStatusComposerControl";

/** Every section populated so the card's full anatomy is judgeable at once:
 * codex-ordered source control (review / commit-push / compare / checks with
 * hover detail), pixel-sprite subagents, and native count rows whose hover
 * cards list the individual agents/terminals/loops. */
export function createPlaygroundWorkspaceStatusModel(): WorkspaceStatusModel {
  return {
    environment: {
      reviewChangesLabel: "Review 12 changes",
      commitOrPushLabel: "Commit or push",
      commitOrPushMeta: "2 ahead",
      commitOrPushDisabled: false,
      compareLabel: "View PR",
      compareMeta: "#1042",
      compareOpensPr: true,
      compareDisabled: false,
      checks: {
        label: "1 failing check",
        state: "failing",
        actionLabel: "View",
        items: [
          {
            key: "check-vitest",
            name: "CI / desktop-vitest",
            state: "failing",
            detail: "ComposerReasoningEffortBars renders the tier label for ultra ladders — expected \"Ultra\", received \"Xhigh\".",
            meta: "4m",
          },
          {
            key: "check-shape",
            name: "CI / repo-shape",
            state: "passing",
            meta: "2m",
          },
          {
            key: "check-vercel",
            name: "Vercel · landing",
            state: "pending",
            meta: "40s",
          },
        ],
      },
    },
    subagents: {
      working: [
        {
          key: "sub-epicurus",
          name: "Epicurus",
          sessionId: "playground-session-epicurus",
          tintClassName: "text-delegated-agent-1",
        },
      ],
      done: [
        {
          key: "sub-averroes",
          name: "Averroes",
          sessionId: "playground-session-averroes",
          tintClassName: "text-delegated-agent-2",
        },
        {
          key: "sub-darwin",
          name: "Darwin",
          sessionId: "playground-session-darwin",
          tintClassName: "text-delegated-agent-3",
        },
      ],
    },
    native: [
      {
        key: "native-agents",
        kind: "agents",
        label: "2 subagents",
        meta: "1 running",
        items: [
          {
            key: "native-explore",
            name: "Explore auth boundary",
            state: "working",
            meta: "12m",
          },
          {
            key: "native-summarize",
            name: "Summarize failures",
            state: "done",
            meta: "31m",
          },
        ],
      },
      {
        key: "native-terminals",
        kind: "terminals",
        label: "2 terminals",
        meta: "1 running",
        items: [
          {
            key: "term-dev",
            name: "pnpm dev",
            state: "working",
            detail: "vite ready on :1430",
            meta: "38m",
          },
          {
            key: "term-test",
            name: "cargo test",
            state: "done",
            detail: "exit 0",
            meta: "14m",
          },
        ],
      },
      {
        key: "native-loops",
        kind: "loops",
        label: "1 loop",
        meta: "next in 3m",
        items: [
          {
            key: "loop-ci",
            name: "Watch CI",
            state: "pending",
            detail: "every 5m · /check-ci",
            meta: "3m",
          },
        ],
      },
    ],
  };
}
