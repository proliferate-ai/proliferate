export type AutomationExecutionTarget = "cloud" | "local";

export interface AutomationScheduleSnapshot {
  rrule?: string;
  summary: string;
  nextRunAt: string | null;
  timezone?: string | null;
}

export interface AutomationRecord {
  id: string;
  gitOwner: string;
  gitRepoName: string;
  title: string;
  schedule: AutomationScheduleSnapshot;
  executionTarget: AutomationExecutionTarget;
  enabled: boolean;
}

export interface AutomationRunRecord {
  triggerKind: string;
  scheduledFor: string | null;
  executionTarget: AutomationExecutionTarget;
  status: string;
  lastErrorMessage: string | null;
  createdAt: string;
}

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
  gitProvider?: string | null;
  gitOwner?: string | null;
  gitRepoName?: string | null;
  displayName?: string | null;
  currentBranch?: string | null;
  originalBranch?: string | null;
}

export interface AutomationTargetRepoConfigRecord {
  gitOwner: string;
  gitRepoName: string;
  configured: boolean;
}

export interface AutomationTargetCloudWorkspaceRecord {
  repo: {
    provider: string;
    owner: string;
    name: string;
  };
}
