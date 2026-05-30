import { demoChats, demoCurrentUser, demoWorkspaces } from "@proliferate/product-domain/chats/fixtures";
import type { ChatKind, ProductChat, ProductUser, ProductWorkspace } from "@proliferate/product-domain/chats/model";

export const currentUser: ProductUser = demoCurrentUser;

export const workspaces: ProductWorkspace[] = [
  ...demoWorkspaces,
  {
    id: "docs-cloud",
    name: "Docs cloud",
    repoLabel: "proliferate-ai/docs",
    branchLabel: "main",
    kind: "personal",
  },
];

export const chats: ProductChat[] = [
  ...demoChats,
  {
    id: "slack-2",
    workspaceId: "shared-cloud",
    title: "Draft release notes for 0.9",
    kind: "slack",
    status: "idle",
    claimantUserId: "user-pablo",
    claimantName: "Pablo",
  },
  {
    id: "dispatch-1",
    workspaceId: "personal-cloud",
    title: "AnyHarness retry policy",
    kind: "dispatch",
    status: "paused",
  },
  {
    id: "cloud-2",
    workspaceId: "docs-cloud",
    title: "Public MCP setup copy",
    kind: "cloud",
    status: "done",
    claimantUserId: "user-pablo",
    claimantName: "Pablo",
  },
];

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  body: string;
}

export const chatMessages: Record<string, ChatMessage[]> = {
  "slack-1": [
    {
      id: "m1",
      role: "system",
      body: "Slack thread opened a shared cloud session in proliferate-ai/proliferate.",
    },
    {
      id: "m2",
      role: "user",
      body: "Can someone check why the worker CI keeps flaking after the retry change?",
    },
    {
      id: "m3",
      role: "assistant",
      body: "I found one test waiting on a stale poll interval. I am tightening the assertion and rerunning the worker suite.",
    },
  ],
  "automation-1": [
    {
      id: "m1",
      role: "system",
      body: "Candidate Screening #12 is running in the shared sandbox.",
    },
    {
      id: "m2",
      role: "assistant",
      body: "Parsed inbound profile data and opened a review branch with the ranked summary.",
    },
  ],
};

export interface AutomationSummary {
  id: string;
  name: string;
  owner: "team" | "personal";
  scheduleLabel: string;
  targetLabel: string;
  status: "enabled" | "paused";
  lastRunLabel: string;
}

export const automations: AutomationSummary[] = [
  {
    id: "candidate-screening",
    name: "Candidate Screening",
    owner: "team",
    scheduleLabel: "Every weekday at 8:00 AM",
    targetLabel: "Shared cloud - proliferate-ai/proliferate",
    status: "enabled",
    lastRunLabel: "42 minutes ago",
  },
  {
    id: "dependency-bump",
    name: "Dependency Bump",
    owner: "team",
    scheduleLabel: "Nightly",
    targetLabel: "Shared cloud - proliferate-ai/proliferate",
    status: "enabled",
    lastRunLabel: "5 hours ago",
  },
  {
    id: "docs-brief",
    name: "Docs Brief",
    owner: "personal",
    scheduleLabel: "Mondays",
    targetLabel: "Personal cloud - proliferate-ai/docs",
    status: "paused",
    lastRunLabel: "2 days ago",
  },
];

export function workspaceForChat(chat: ProductChat): ProductWorkspace | undefined {
  return workspaces.find((workspace) => workspace.id === chat.workspaceId);
}

export function chatsForWorkspace(workspaceId: string): ProductChat[] {
  return chats.filter((chat) => chat.workspaceId === workspaceId);
}

export function chatCountsByKind(): Record<ChatKind, number> {
  return chats.reduce<Record<ChatKind, number>>(
    (counts, chat) => {
      counts[chat.kind] += 1;
      return counts;
    },
    {
      slack: 0,
      "shared-auto": 0,
      "shared-chat": 0,
      cloud: 0,
      dispatch: 0,
    },
  );
}
