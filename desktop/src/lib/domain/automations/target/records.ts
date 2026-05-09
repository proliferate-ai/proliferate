export type AutomationExecutionTarget = "cloud" | "local";

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
