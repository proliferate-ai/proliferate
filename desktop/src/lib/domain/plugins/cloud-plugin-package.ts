import type { PluginPackageCatalogEntry } from "@/lib/domain/plugins/types";

interface CloudPluginPackageLike {
  id: string;
  catalogEntryId: string;
  version: string;
  displayName: string;
  description: string;
  skills?: readonly CloudPluginPackageSkillLike[];
}

interface CloudPluginPackageSkillLike {
  id: string;
  displayName: string;
  description: string;
  instructions: string;
  requiredMcpServerRefs?: readonly string[];
  requiresCredentialBinding: boolean;
  resources?: readonly {
    resourceId: string;
    displayName?: string | null;
    contentType: string;
    content: string;
  }[];
  defaultEnabled: boolean;
  provenance?: {
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
    notes?: string | null;
  };
}

export function cloudPluginPackageToLocal(
  pluginPackage: CloudPluginPackageLike,
): PluginPackageCatalogEntry {
  return {
    id: pluginPackage.id,
    catalogEntryId: pluginPackage.catalogEntryId,
    version: pluginPackage.version,
    displayName: pluginPackage.displayName,
    description: pluginPackage.description,
    skills: (pluginPackage.skills ?? []).map((skill) => ({
      id: skill.id,
      displayName: skill.displayName,
      description: skill.description,
      instructions: skill.instructions,
      requiredMcpServerRefs: skill.requiredMcpServerRefs ?? [],
      requiresCredentialBinding: skill.requiresCredentialBinding,
      resources: (skill.resources ?? []).map((resource) => ({
        resourceId: resource.resourceId,
        displayName: resource.displayName ?? undefined,
        contentType: resource.contentType,
        content: resource.content,
      })),
      defaultEnabled: skill.defaultEnabled,
      provenance: skill.provenance
        ? {
          sourceRepoUrl: skill.provenance.sourceRepoUrl,
          sourcePath: skill.provenance.sourcePath,
          sourceRef: skill.provenance.sourceRef,
          sourceSha256: skill.provenance.sourceSha256,
          adaptedSha256: skill.provenance.adaptedSha256,
          sourceLicense: skill.provenance.sourceLicense,
          importMode: skill.provenance.importMode,
          reviewStatus: skill.provenance.reviewStatus,
          reviewer: skill.provenance.reviewer,
          reviewedAt: skill.provenance.reviewedAt,
          notes: skill.provenance.notes ?? undefined,
        }
        : undefined,
    })),
  };
}
