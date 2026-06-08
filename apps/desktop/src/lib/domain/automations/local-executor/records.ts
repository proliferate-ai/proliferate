export interface AutomationRunClaimRecord {
  id: string;
  titleSnapshot: string;
  gitProviderSnapshot: string;
  gitOwnerSnapshot: string;
  gitRepoNameSnapshot: string;
}

export interface AutomationRepoRootRecord {
  id: string;
  kind?: string;
  path: string;
  displayName?: string | null;
  remoteProvider?: string | null;
  remoteOwner?: string | null;
  remoteRepoName?: string | null;
  remoteUrl?: string | null;
  defaultBranch?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AutomationWorkspaceRecord {
  id: string;
  kind: string;
  path?: string;
  repoRootId?: string | null;
  displayName?: string | null;
  currentBranch?: string | null;
  originalBranch?: string | null;
}
