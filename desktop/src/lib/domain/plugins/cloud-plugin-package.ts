import type { CloudPluginPackage } from "@/lib/access/cloud/client";
import type { PluginPackageCatalogEntry } from "@/lib/domain/plugins/types";

export function cloudPluginPackageToLocal(
  pluginPackage: CloudPluginPackage,
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

