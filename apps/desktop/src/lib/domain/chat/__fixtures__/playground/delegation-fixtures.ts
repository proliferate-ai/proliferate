import type {
  DelegatedAgentIdentity,
  DelegatedWorkStatusCategory,
} from "@/lib/domain/delegated-work/model";
import { buildDelegatedAgentIdentity } from "@/lib/domain/delegated-work/identity";
import {
  delegatedWorkStatusCategoryFromLabel,
} from "@/lib/domain/delegated-work/presentation";

type PlaygroundSubagentStripRow = {
  sessionLinkId: string;
  childSessionId: string;
  label: string;
  identity: DelegatedAgentIdentity;
  statusLabel: string;
  statusCategory: DelegatedWorkStatusCategory;
  latestCompletionLabel: string | null;
  wakeScheduled: boolean;
};

const RAW_PLAYGROUND_SUBAGENT_STRIP_ROWS = [
  {
    sessionLinkId: "link-haiku-session-lifecycle",
    childSessionId: "298c62c7-b359-4cc7-a65e-b297ebabce2f",
    label: "session-lifecycle",
    statusLabel: "Idle",
    latestCompletionLabel: "Completed turn",
    wakeScheduled: false,
  },
  {
    sessionLinkId: "link-sonnet-cloud-auth",
    childSessionId: "67aa6956-3cfb-4b7c-a2ea-faf470f2e74e",
    label: "cloud-auth",
    statusLabel: "Idle",
    latestCompletionLabel: null,
    wakeScheduled: true,
  },
  {
    sessionLinkId: "link-codex-server-routes",
    childSessionId: "8cfbaa2a-404e-4dac-ad04-25b8a066a514",
    label: "server-routes",
    statusLabel: "Idle",
    latestCompletionLabel: "Completed turn",
    wakeScheduled: false,
  },
  {
    sessionLinkId: "link-codex-cicd",
    childSessionId: "0d3f015b-5de1-4984-badd-d1a0f022947f",
    label: "ci-cd",
    statusLabel: "Idle",
    latestCompletionLabel: "Completed turn",
    wakeScheduled: false,
  },
  {
    sessionLinkId: "link-grok-mcp-catalog",
    childSessionId: "354f014b-886a-4957-b315-f99e1c07ede4",
    label: "mcp-catalog",
    statusLabel: "Failed",
    latestCompletionLabel: "Failed turn",
    wakeScheduled: false,
  },
  {
    sessionLinkId: "link-grok-sdk",
    childSessionId: "9d817b15-eda5-43a8-9141-d7db85993c45",
    label: "sdk-surface",
    statusLabel: "Working",
    latestCompletionLabel: null,
    wakeScheduled: true,
  },
  {
    sessionLinkId: "link-opencode-cloud-runtime",
    childSessionId: "7c9d7648-0041-440e-85b1-17de9e2b70d8",
    label: "cloud-runtime",
    statusLabel: "Working",
    latestCompletionLabel: null,
    wakeScheduled: false,
  },
  {
    sessionLinkId: "link-cursor-tauri-commands",
    childSessionId: "a1124490-6516-4b52-a5f4-fde1eee57c2d",
    label: "tauri-commands",
    statusLabel: "Idle",
    latestCompletionLabel: "Completed turn",
    wakeScheduled: false,
  },
  {
    sessionLinkId: "link-runtime-server-sdk-survey",
    childSessionId: "b5870e25-f4f7-a08b-61d6e703177b",
    label: "runtime-server-sdk-survey",
    statusLabel: "Working",
    latestCompletionLabel: null,
    wakeScheduled: true,
  },
  {
    sessionLinkId: "link-frontend-repo-survey",
    childSessionId: "03ff96b2-9ca2-4df7-9296-c3b5146dfc6a",
    label: "frontend-repo-survey",
    statusLabel: "Working",
    latestCompletionLabel: null,
    wakeScheduled: true,
  },
] satisfies Omit<PlaygroundSubagentStripRow, "identity" | "statusCategory">[];

export const PLAYGROUND_SUBAGENT_STRIP_ROWS: PlaygroundSubagentStripRow[] =
  RAW_PLAYGROUND_SUBAGENT_STRIP_ROWS.map((row) => ({
    ...row,
    identity: buildDelegatedAgentIdentity({
      id: row.sessionLinkId,
      title: row.label,
      sessionId: row.childSessionId,
      sessionLinkId: row.sessionLinkId,
    }),
    statusCategory: delegatedWorkStatusCategoryFromLabel({
      statusLabel: row.statusLabel,
      wakeScheduled: row.wakeScheduled,
    }),
  }));
