export type ChatKind =
  | "slack"
  | "shared-auto"
  | "shared-chat"
  | "cloud"
  | "dispatch";

export type WorkspaceKind = "shared" | "personal";

export type ClaimState =
  | { kind: "not_claimable" }
  | { kind: "unclaimed" }
  | { kind: "claimed_by_me" }
  | { kind: "claimed_by_other"; claimantName: string };

export interface ProductUser {
  id: string;
  displayName: string;
}

export interface ProductWorkspace {
  id: string;
  name: string;
  repoLabel: string;
  branchLabel: string;
  kind: WorkspaceKind;
}

export interface ProductChat {
  id: string;
  workspaceId: string;
  title: string;
  kind: ChatKind;
  status: "running" | "idle" | "paused" | "failed" | "done";
  claimantUserId?: string | null;
  claimantName?: string | null;
}

export type ChatPrimaryAction =
  | { kind: "claim"; label: "Claim" }
  | { kind: "continue_in_desktop"; label: "Continue in desktop" }
  | { kind: "none"; label: "" };
