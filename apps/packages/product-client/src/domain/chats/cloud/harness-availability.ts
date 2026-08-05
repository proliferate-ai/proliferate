export const CLOUD_AGENT_KIND_ORDER = ["claude", "codex", "opencode", "grok"] as const;
export const DEFAULT_CLOUD_LAUNCHABLE_AGENT_KINDS = ["claude", "codex"] as const;

export interface CloudHarnessAvailability {
  launchableAgentKinds: string[];
  message: string | null;
}

export function resolveCloudHarnessAvailability(input: {
  catalogAgentKinds?: readonly string[] | null;
  allowedAgentKinds?: readonly string[] | null;
}): CloudHarnessAvailability {
  const catalogAgentKinds = normalizeCloudAgentKindList(input.catalogAgentKinds);
  const allowedAgentKinds = normalizeCloudAgentKindList(input.allowedAgentKinds);

  const catalog = catalogAgentKinds.length > 0
    ? new Set(catalogAgentKinds)
    : new Set(CLOUD_AGENT_KIND_ORDER);
  const allowed = new Set(
    allowedAgentKinds.length > 0 ? allowedAgentKinds : CLOUD_AGENT_KIND_ORDER,
  );
  const launchableAgentKinds = CLOUD_AGENT_KIND_ORDER
    .filter((kind) => catalog.has(kind) && allowed.has(kind));

  return {
    launchableAgentKinds,
    message: launchableAgentKinds.length > 0
      ? null
      : "No cloud agents are available for this workspace.",
  };
}

export function normalizeCloudAgentKindList(
  values: readonly string[] | null | undefined,
): string[] {
  if (!values) {
    return [];
  }
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const kind = normalizeCloudAgentKind(value);
    if (!kind || seen.has(kind)) {
      continue;
    }
    seen.add(kind);
    normalized.push(kind);
  }
  return normalized.sort((left, right) =>
    cloudAgentKindSortIndex(left) - cloudAgentKindSortIndex(right)
  );
}

export function normalizeCloudAgentKind(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized && CLOUD_AGENT_KIND_ORDER.includes(normalized as never)
    ? normalized
    : null;
}

function cloudAgentKindSortIndex(agentKind: string): number {
  const index = CLOUD_AGENT_KIND_ORDER.indexOf(agentKind as never);
  return index >= 0 ? index : CLOUD_AGENT_KIND_ORDER.length;
}
