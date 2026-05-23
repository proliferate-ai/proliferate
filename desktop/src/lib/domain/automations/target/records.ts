export type AutomationExecutionTarget = "cloud" | "local" | "ssh";

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
