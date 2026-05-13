import type {
  SessionMcpBindingSummary,
  SessionMcpServer,
  SessionPluginBundle,
  SessionPluginSkill,
} from "@anyharness/sdk";
import type { PluginPackageCatalogEntry, PluginPackageSkill } from "@/lib/domain/plugins/types";

export function buildSessionPluginBundle(input: {
  mcpServers: SessionMcpServer[];
  mcpBindingSummaries: SessionMcpBindingSummary[];
  pluginPackages?: readonly PluginPackageCatalogEntry[];
}): SessionPluginBundle | undefined {
  const appliedSummaries = input.mcpBindingSummaries.filter(
    (summary) => summary.outcome === "applied",
  );
  if (appliedSummaries.length === 0) {
    return undefined;
  }
  const pluginPackagesByCatalogEntryId = new Map(
    (input.pluginPackages ?? []).map((pluginPackage) => [
      pluginPackage.catalogEntryId,
      pluginPackage,
    ]),
  );

  const plugins: NonNullable<SessionPluginBundle["plugins"]> = appliedSummaries.flatMap((summary) => {
    const mcpServers = input.mcpServers.filter((server) =>
      sessionMcpConnectionId(server) === summary.id
    );
    if (mcpServers.length === 0) {
      return [];
    }
    const pluginId = `connector.${summary.id}`;
    const displayName = summary.displayName ?? titleCase(summary.serverName);
    const catalogEntryId = firstCatalogEntryId(mcpServers);
    const pluginPackage = catalogEntryId
      ? pluginPackagesByCatalogEntryId.get(catalogEntryId)
      : undefined;
    const skills = (pluginPackage?.skills ?? [])
      .filter((skill) => skill.defaultEnabled)
      .flatMap((skill) => {
        const sessionSkill = sessionSkillFromCatalogSkill({
          pluginId,
          skill,
          summary,
          mcpServers,
        });
        return sessionSkill ? [sessionSkill] : [];
      });

    return [{
      pluginId,
      version: pluginPackage?.version ?? "local",
      skills,
      mcpServers,
      mcpBindingSummaries: [summary],
      credentialBindings: [{
        id: summary.id,
        displayName,
        status: "ready" as const,
      }],
    }];
  });
  if (plugins.length === 0) {
    return undefined;
  }
  return {
    plugins,
  };
}

function sessionSkillFromCatalogSkill({
  pluginId,
  skill,
  summary,
  mcpServers,
}: {
  pluginId: string;
  skill: PluginPackageSkill;
  summary: SessionMcpBindingSummary;
  mcpServers: SessionMcpServer[];
}): SessionPluginSkill | null {
  const requiredMcpServers = concreteRequiredMcpServers(skill, mcpServers, summary);
  if (!requiredMcpServers) {
    return null;
  }
  return {
    skillId: `${pluginId}.${skill.id}`,
    displayName: skill.displayName,
    description: skill.description,
    instructions: skill.instructions,
    requiredMcpServers,
    credentialBindingIds: skill.requiresCredentialBinding ? [summary.id] : [],
    resources: skill.resources.map((resource) => ({
      resourceId: resource.resourceId,
      displayName: resource.displayName ?? undefined,
      contentType: resource.contentType,
      content: resource.content,
    })),
  };
}

function concreteRequiredMcpServers(
  skill: PluginPackageSkill,
  mcpServers: SessionMcpServer[],
  summary: SessionMcpBindingSummary,
): string[] | null {
  const refs = new Set(skill.requiredMcpServerRefs);
  const matchedServers = refs.size === 0
    ? mcpServers
    : mcpServers.filter((server) =>
      refs.has(sessionMcpCatalogEntryId(server) ?? "")
      || refs.has(sessionMcpServerName(server))
    );
  const names = matchedServers.map(sessionMcpServerName);
  if (names.length > 0) {
    return names;
  }
  return refs.size === 0 ? [summary.serverName] : null;
}

function sessionMcpConnectionId(server: SessionMcpServer): string {
  return server.connectionId;
}

function sessionMcpCatalogEntryId(server: SessionMcpServer): string | undefined {
  return server.catalogEntryId ?? undefined;
}

function sessionMcpServerName(server: SessionMcpServer): string {
  return server.serverName;
}

function firstCatalogEntryId(servers: readonly SessionMcpServer[]): string | undefined {
  return servers
    .map(sessionMcpCatalogEntryId)
    .find((catalogEntryId): catalogEntryId is string => !!catalogEntryId);
}

function titleCase(value: string): string {
  return value
    .split(/[_\-\s]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
