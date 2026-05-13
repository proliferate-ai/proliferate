export interface PluginSkillProvenance {
  sourceRepoUrl: string;
  sourcePath: string;
  sourceRef: string;
  sourceSha256: string;
  adaptedSha256: string;
  sourceLicense: string;
  importMode: "adapted" | "vendored";
  reviewStatus: "reviewed" | "pending";
  reviewer: string;
  reviewedAt: string;
  notes?: string;
}

export interface PluginSkillResource {
  resourceId: string;
  displayName?: string | null;
  contentType: string;
  content: string;
}

export interface PluginPackageSkill {
  id: string;
  displayName: string;
  description: string;
  instructions: string;
  requiredMcpServerRefs: readonly string[];
  requiresCredentialBinding: boolean;
  resources: readonly PluginSkillResource[];
  defaultEnabled: boolean;
  provenance?: PluginSkillProvenance;
}

export interface PluginPackageCatalogEntry {
  id: string;
  catalogEntryId: string;
  version: string;
  displayName: string;
  description: string;
  skills: readonly PluginPackageSkill[];
}

