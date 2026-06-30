export interface CloudRepoFileMetadata {
  relativePath: string;
  contentSha256: string;
  byteSize: number;
  updatedAt: string;
  lastSyncedAt: string;
  content?: string | null;
}

export interface CloudRepoConfig {
  configured: boolean;
  configuredAt: string | null;
  defaultBranch: string | null;
  envVars: Record<string, string>;
  setupScript: string;
  runCommand: string;
  filesVersion: number;
  trackedFiles: CloudRepoFileMetadata[];
}

export interface CloudRepoConfigSummary {
  gitOwner: string;
  gitRepoName: string;
  configured: boolean;
  configuredAt: string | null;
  defaultBranch?: string | null;
  filesVersion: number;
}

export interface CloudRepoConfigsList {
  configs: CloudRepoConfigSummary[];
}
