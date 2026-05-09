type PlaygroundSubagentStripRow = {
  sessionLinkId: string;
  childSessionId: string;
  label: string;
  statusLabel: string;
  latestCompletionLabel: string | null;
  wakeScheduled: boolean;
};

export const PLAYGROUND_SUBAGENT_STRIP_ROWS: PlaygroundSubagentStripRow[] = [
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
    sessionLinkId: "link-gemini-pro-mcp-catalog",
    childSessionId: "354f014b-886a-4957-b315-f99e1c07ede4",
    label: "mcp-catalog",
    statusLabel: "Failed",
    latestCompletionLabel: "Failed turn",
    wakeScheduled: false,
  },
  {
    sessionLinkId: "link-gemini-flash-sdk",
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
];

export type PlaygroundReviewComposerStatus =
  | "Starting"
  | "Reviewing"
  | "Requests changes"
  | "Approved"
  | "Failed";

export interface PlaygroundReviewComposerRow {
  id: string;
  label: string;
  detail: string | null;
  status: PlaygroundReviewComposerStatus;
  hasCritique: boolean;
}

export interface PlaygroundReviewComposerState {
  summary: {
    label: string;
    detail: string | null;
    active: boolean;
  };
  rows: PlaygroundReviewComposerRow[];
  deliveryLabel: string | null;
  actionLabel: string | null;
}

export const PLAYGROUND_REVIEW_COMPOSER_STATES: Record<string, PlaygroundReviewComposerState> = {
  "subagents-review-starting-plan": {
    summary: {
      label: "3 agents reviewing plan",
      detail: "Plan review · round 1/2",
      active: true,
    },
    rows: [
      { id: "architecture", label: "Architecture reviewer", detail: null, status: "Starting", hasCritique: false },
      { id: "ux", label: "UX reviewer", detail: null, status: "Starting", hasCritique: false },
      { id: "risk", label: "Risk reviewer", detail: null, status: "Starting", hasCritique: false },
    ],
    deliveryLabel: null,
    actionLabel: null,
  },
  "subagents-review-starting-code": {
    summary: {
      label: "2 agents reviewing code",
      detail: "Code review · round 1/2",
      active: true,
    },
    rows: [
      { id: "correctness", label: "Correctness reviewer", detail: null, status: "Starting", hasCritique: false },
      { id: "product", label: "Product reviewer", detail: null, status: "Starting", hasCritique: false },
    ],
    deliveryLabel: null,
    actionLabel: null,
  },
  "subagents-reviewing-plan": {
    summary: {
      label: "3 agents reviewing plan",
      detail: "Plan review · 1/3",
      active: true,
    },
    rows: [
      { id: "architecture", label: "Architecture reviewer", detail: null, status: "Reviewing", hasCritique: false },
      {
        id: "ux",
        label: "UX reviewer",
        detail: "Navigation state needs a single selected-workspace owner.",
        status: "Requests changes",
        hasCritique: true,
      },
      { id: "risk", label: "Risk reviewer", detail: null, status: "Reviewing", hasCritique: false },
    ],
    deliveryLabel: null,
    actionLabel: null,
  },
  "subagents-reviewing-code": {
    summary: {
      label: "2 review agents reviewing code",
      detail: "Code review · 1/2",
      active: true,
    },
    rows: [
      { id: "security", label: "Security reviewer", detail: null, status: "Reviewing", hasCritique: false },
      {
        id: "ux",
        label: "UX reviewer",
        detail: "Approval copy should not compete with the composer controls.",
        status: "Requests changes",
        hasCritique: true,
      },
    ],
    deliveryLabel: null,
    actionLabel: null,
  },
  "subagents-review-feedback-ready": {
    summary: {
      label: "3 agents critiqued plan",
      detail: "Feedback ready · 3/3",
      active: true,
    },
    rows: [
      {
        id: "architecture",
        label: "Architecture reviewer",
        detail: "Plan needs a clearer state owner before implementation.",
        status: "Requests changes",
        hasCritique: true,
      },
      {
        id: "ux",
        label: "UX reviewer",
        detail: "Reduce duplicate review controls in the composer.",
        status: "Requests changes",
        hasCritique: true,
      },
      {
        id: "risk",
        label: "Risk reviewer",
        detail: "No blocking workflow risk found.",
        status: "Approved",
        hasCritique: true,
      },
    ],
    deliveryLabel: "Feedback is ready to send back to the parent agent.",
    actionLabel: "Send feedback",
  },
  "subagents-review-complete": {
    summary: {
      label: "3 agents approved plan",
      detail: "Passed · 3/3",
      active: false,
    },
    rows: [
      {
        id: "architecture",
        label: "Architecture reviewer",
        detail: "State ownership is clear.",
        status: "Approved",
        hasCritique: true,
      },
      {
        id: "ux",
        label: "UX reviewer",
        detail: "Composer flow is ready.",
        status: "Approved",
        hasCritique: true,
      },
      {
        id: "risk",
        label: "Risk reviewer",
        detail: "No blocking workflow risk found.",
        status: "Approved",
        hasCritique: true,
      },
    ],
    deliveryLabel: "All reviewers approved the latest revision.",
    actionLabel: "Dismiss",
  },
};
