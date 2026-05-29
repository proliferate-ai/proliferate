import { demoChats, demoCurrentUser, demoWorkspaces } from "@proliferate/product-domain/chats/fixtures";
import type { ProductChat, ProductUser, ProductWorkspace } from "@proliferate/product-domain/chats/model";

export const currentUser: ProductUser = demoCurrentUser;
export const workspaces: ProductWorkspace[] = demoWorkspaces;

export const chats: ProductChat[] = [
  ...demoChats,
  {
    id: "dispatch-1",
    workspaceId: "personal-cloud",
    title: "AnyHarness retry policy",
    kind: "dispatch",
    status: "paused",
  },
  {
    id: "slack-2",
    workspaceId: "shared-cloud",
    title: "Draft release notes for 0.9",
    kind: "slack",
    status: "idle",
    claimantUserId: "user-pablo",
    claimantName: "Pablo",
  },
];

export const automations = [
  {
    id: "candidate-screening",
    name: "Candidate Screening",
    detail: "Team - weekdays at 8:00 AM",
    status: "enabled",
  },
  {
    id: "dependency-bump",
    name: "Dependency Bump",
    detail: "Team - nightly dependency PR",
    status: "enabled",
  },
  {
    id: "docs-brief",
    name: "Docs Brief",
    detail: "Personal - Mondays",
    status: "paused",
  },
] as const;

export const chatMessages = [
  {
    id: "m1",
    role: "system",
    body: "Shared cloud session opened from Slack.",
  },
  {
    id: "m2",
    role: "user",
    body: "Can someone check why the worker CI keeps flaking after the retry change?",
  },
  {
    id: "m3",
    role: "assistant",
    body: "I found the stale poll interval and am rerunning the worker suite.",
  },
] as const;

export function workspaceForChat(chat: ProductChat): ProductWorkspace | undefined {
  return workspaces.find((workspace) => workspace.id === chat.workspaceId);
}
