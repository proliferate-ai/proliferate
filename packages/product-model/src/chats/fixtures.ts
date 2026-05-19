import type { ProductChat, ProductUser, ProductWorkspace } from "./model";

export const demoCurrentUser: ProductUser = {
  id: "user-pablo",
  displayName: "Pablo",
};

export const demoWorkspaces: ProductWorkspace[] = [
  {
    id: "shared-cloud",
    name: "Shared cloud",
    repoLabel: "proliferate-ai/proliferate",
    branchLabel: "main",
    kind: "shared",
  },
  {
    id: "personal-cloud",
    name: "Personal cloud",
    repoLabel: "pablo/proliferate",
    branchLabel: "feature/mobile-web",
    kind: "personal",
  },
];

export const demoChats: ProductChat[] = [
  {
    id: "slack-1",
    workspaceId: "shared-cloud",
    title: "Fix flaky worker CI",
    kind: "slack",
    status: "running",
  },
  {
    id: "automation-1",
    workspaceId: "shared-cloud",
    title: "Candidate Screening #12",
    kind: "shared-auto",
    status: "running",
  },
  {
    id: "shared-1",
    workspaceId: "shared-cloud",
    title: "Cloud sandbox settings review",
    kind: "shared-chat",
    status: "idle",
    claimantUserId: "user-jo",
    claimantName: "Jo",
  },
  {
    id: "cloud-1",
    workspaceId: "personal-cloud",
    title: "Git and file modal cleanup",
    kind: "cloud",
    status: "idle",
    claimantUserId: "user-pablo",
    claimantName: "Pablo",
  },
];
