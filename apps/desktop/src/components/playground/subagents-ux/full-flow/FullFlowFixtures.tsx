// Fixture data for the coherent default "full flow" lane: several parent
// sessions with runtime-observable subagent rosters, immutable creation
// receipts embedded in the parent transcripts, and an archive of closed
// child sessions whose transcripts stay reopenable after the relationship
// is deleted. Prototype-local on purpose, matching the other lanes.

import type {
  PrototypeAgentStatus,
  PrototypeGit,
} from "../popover-pane/PopoverPaneFixtures";
import type { SubagentReceiptModel } from "../identity-receipts/SubagentCreationReceipt";

export interface FullFlowMessage {
  speaker: "user" | "agent" | "tool";
  text: string;
}

export type FullFlowTranscriptItem =
  | { kind: "message"; message: FullFlowMessage }
  | { kind: "receipt"; receipt: SubagentReceiptModel };

export interface FullFlowChild {
  id: string;
  /** Agent-supplied task label — the primary identity everywhere. */
  label: string;
  harness: string;
  status: PrototypeAgentStatus;
  /** Metadata, never a roster state. */
  wakeScheduled: boolean;
  /** Composed status line ("Working · 4m"); last-turn metadata for Done/Idle. */
  detail: string;
  transcript: FullFlowMessage[];
}

export interface FullFlowParent {
  id: string;
  title: string;
  git: PrototypeGit;
  transcript: FullFlowTranscriptItem[];
  children: FullFlowChild[];
}

export interface FullFlowArchivedSession {
  id: string;
  label: string;
  parentTitle: string;
  /** "Closed · Yesterday" — archive listing line. */
  closedDetail: string;
  transcript: FullFlowMessage[];
}

export interface FullFlowWorkspace {
  parents: FullFlowParent[];
  archived: FullFlowArchivedSession[];
}

const SHIP_GIT: PrototypeGit = {
  branch: "feat/workspace-activity",
  changedFiles: 6,
  stagedFiles: 2,
  ahead: 2,
  behind: 0,
  conflictedFiles: 0,
  pullRequestLabel: "PR #1042 · Open · Checks passing",
};

const AUTH_GIT: PrototypeGit = {
  branch: "feat/auth-hardening",
  changedFiles: 3,
  stagedFiles: 0,
  ahead: 0,
  behind: 1,
  conflictedFiles: 0,
  pullRequestLabel: null,
};

export function buildFullFlowWorkspace(): FullFlowWorkspace {
  return {
    parents: [
      {
        id: "ff-parent-workspace-activity",
        title: "Ship workspace activity",
        git: { ...SHIP_GIT },
        transcript: [
          {
            kind: "message",
            message: {
              speaker: "user",
              text: "Land the workspace activity card. Delegate the checks that can run in parallel.",
            },
          },
          {
            kind: "message",
            message: {
              speaker: "agent",
              text: "I split out four bounded checks and delegated them. I'll keep integrating here and read their results as they finish.",
            },
          },
          {
            kind: "receipt",
            receipt: {
              subagentId: "subagent_ff_api-surface-check",
              title: "API Surface Check",
              harnessLabel: "Claude",
              wakeScheduled: true,
              timestamp: "2026-07-11 14:02",
              prompt: "Inspect the public API surface for contract mismatches against the SDK.",
            },
          },
          {
            kind: "receipt",
            receipt: {
              subagentId: "subagent_ff_sdk-types-sync",
              title: "SDK Types Sync",
              harnessLabel: "Codex",
              wakeScheduled: false,
              timestamp: "2026-07-11 14:02",
              prompt: "Regenerate SDK types and flag any drift from the contract crate.",
            },
          },
          {
            kind: "receipt",
            receipt: {
              subagentId: "subagent_ff_flaky-test-hunt",
              title: "Flaky Test Hunt",
              harnessLabel: "Codex",
              wakeScheduled: false,
              timestamp: "2026-07-11 14:05",
              prompt: "Re-run the desktop vitest suite 10x and isolate any flaky specs.",
            },
          },
          {
            kind: "receipt",
            receipt: {
              subagentId: "subagent_ff_changelog-draft",
              title: "Changelog Draft",
              harnessLabel: "Claude",
              wakeScheduled: true,
              timestamp: "2026-07-11 14:08",
              prompt: "Draft changelog entries for the workspace activity card from the merged PRs.",
            },
          },
          {
            kind: "message",
            message: {
              speaker: "agent",
              text: "Changelog Draft finished — its summary is in the pane. The flaky test hunt hit a tool error; I'll read its last turn before retrying.",
            },
          },
        ],
        children: [
          {
            id: "subagent_ff_api-surface-check",
            label: "API Surface Check",
            harness: "Claude",
            status: "running",
            wakeScheduled: true,
            detail: "Working · 4m",
            transcript: [
              {
                speaker: "agent",
                text: "Diffing the exported contract types against the generated SDK surface.",
              },
              {
                speaker: "tool",
                text: "read anyharness-contract/src/v1/sessions.rs (412 lines)",
              },
              {
                speaker: "agent",
                text: "Found one candidate mismatch in create_subagent; verifying against the TS client before reporting.",
              },
            ],
          },
          {
            id: "subagent_ff_sdk-types-sync",
            label: "SDK Types Sync",
            harness: "Codex",
            status: "running",
            wakeScheduled: false,
            detail: "Working · 2m",
            transcript: [
              {
                speaker: "agent",
                text: "Regenerating SDK types from the contract crate.",
              },
              {
                speaker: "tool",
                text: "pnpm --filter @anyharness/sdk generate → OK",
              },
            ],
          },
          {
            id: "subagent_ff_flaky-test-hunt",
            label: "Flaky Test Hunt",
            harness: "Codex",
            status: "errored",
            wakeScheduled: false,
            detail: "Failed · tool error",
            transcript: [
              {
                speaker: "agent",
                text: "Running the desktop vitest suite in a loop to surface order-dependent failures.",
              },
              {
                speaker: "tool",
                text: "vitest run --repeat 10 → exited 1 (sandbox connection lost on pass 4)",
              },
            ],
          },
          {
            id: "subagent_ff_changelog-draft",
            label: "Changelog Draft",
            harness: "Claude",
            status: "completed",
            wakeScheduled: false,
            detail: "Done · Drafted 8 entries",
            transcript: [
              {
                speaker: "agent",
                text: "Collected the merged PRs behind the activity card and drafted entries for each.",
              },
              {
                speaker: "tool",
                text: "wrote docs/changelog/workspace-activity.md (8 entries)",
              },
              {
                speaker: "agent",
                text: "Done. Eight entries drafted; two flagged for a human tone pass.",
              },
            ],
          },
        ],
      },
      {
        id: "ff-parent-auth-hardening",
        title: "Harden auth session handling",
        git: { ...AUTH_GIT },
        transcript: [
          {
            kind: "message",
            message: {
              speaker: "user",
              text: "Harden session handling: key rotation and bulk revocation.",
            },
          },
          {
            kind: "receipt",
            receipt: {
              subagentId: "subagent_ff_session-key-rotation",
              title: "Session Key Rotation",
              harnessLabel: "Claude",
              wakeScheduled: true,
              timestamp: "2026-07-11 11:40",
              prompt: "Implement session key rotation on privilege change plus a 24h schedule.",
            },
          },
          {
            kind: "receipt",
            receipt: {
              subagentId: "subagent_ff_bulk-revocation",
              title: "Bulk Revocation Endpoint",
              harnessLabel: "Codex",
              wakeScheduled: false,
              timestamp: "2026-07-11 11:41",
              prompt: "Add a bulk session revocation endpoint with per-user and global scopes.",
            },
          },
          {
            kind: "message",
            message: {
              speaker: "agent",
              text: "Revocation is done. Rotation finished its last turn and is idle waiting on my review of the rotation triggers.",
            },
          },
        ],
        children: [
          {
            id: "subagent_ff_session-key-rotation",
            label: "Session Key Rotation",
            harness: "Claude",
            status: "idle",
            wakeScheduled: true,
            detail: "Idle · Completed turn",
            transcript: [
              {
                speaker: "agent",
                text: "Rotation now triggers on privilege change and on a 24-hour schedule.",
              },
              {
                speaker: "tool",
                text: "9 files changed · tests passing",
              },
            ],
          },
          {
            id: "subagent_ff_bulk-revocation",
            label: "Bulk Revocation Endpoint",
            harness: "Codex",
            status: "completed",
            wakeScheduled: false,
            detail: "Done · Endpoint + audit events",
            transcript: [
              {
                speaker: "agent",
                text: "POST /sessions/revoke supports per-user and global scopes, one audit event per batch.",
              },
              {
                speaker: "agent",
                text: "Done. Endpoint merged behind the existing auth middleware.",
              },
            ],
          },
        ],
      },
    ],
    archived: [
      {
        id: "subagent_ff_repo-shape-audit",
        label: "Repo Shape Audit",
        parentTitle: "Ship workspace activity",
        closedDetail: "Closed · Yesterday",
        transcript: [
          {
            speaker: "agent",
            text: "Audited the repo-shape rules against the new activity components.",
          },
          {
            speaker: "tool",
            text: "3 violations found · report written to specs/notes/repo-shape-audit.md",
          },
          {
            speaker: "tool",
            text: "Deleted by you. The session transcript stays available here.",
          },
        ],
      },
      {
        id: "subagent_ff_legacy-cookie-spike",
        label: "Spike: Legacy Cookie Migration",
        parentTitle: "Harden auth session handling",
        closedDetail: "Closed · 2 days ago",
        transcript: [
          {
            speaker: "agent",
            text: "Mapped which clients still send the legacy cookie.",
          },
          {
            speaker: "tool",
            text: "Deleted by you after finishing its turn — the legacy path is being removed instead.",
          },
        ],
      },
    ],
  };
}

export const FULL_FLOW_STATUS_LABELS: Record<PrototypeAgentStatus, string> = {
  starting: "Starting",
  running: "Working",
  idle: "Idle",
  completed: "Done",
  errored: "Failed",
  closed: "Closed",
};
