export const CLOUD_AGENT_KIND_ORDER = ["claude", "codex", "gemini", "opencode"] as const;
export const DEFAULT_CLOUD_LAUNCHABLE_AGENT_KINDS = ["claude", "codex"] as const;

export type CloudHarnessUnavailableReason =
  | "agent_gateway_disabled"
  | "managed_credits_disabled"
  | "missing_agent_auth"
  | "opencode_gateway_disabled"
  | "unsupported_cloud_agent";

export interface CloudAgentGatewayCapabilitiesLike {
  enabled?: boolean | null;
  managedCreditsPersonalEnabled?: boolean | null;
  managedCreditsOrganizationEnabled?: boolean | null;
  managedCreditAgentKinds?: readonly string[] | null;
  opencodeGatewayEnabled?: boolean | null;
}

export interface CloudHarnessUnavailableView {
  agentKind: string;
  label: string;
  reason: CloudHarnessUnavailableReason;
}

export interface CloudHarnessAvailability {
  launchableAgentKinds: string[];
  unavailableAgentKinds: CloudHarnessUnavailableView[];
  message: string | null;
}

export interface CloudAgentAuthCredentialLike {
  credentialProviderId?: string | null;
  credentialKind?: string | null;
  redactedSummary?: {
    agentKind?: unknown;
  } | null;
  status?: string | null;
}

export function readySyncedCloudAgentKinds(
  credentials: readonly CloudAgentAuthCredentialLike[] | null | undefined,
): string[] {
  if (!credentials) {
    return [];
  }
  return normalizeCloudAgentKindList(
    credentials
      .filter((credential) =>
        credential.status === "ready" && credential.credentialKind === "synced_path"
      )
      .map((credential) =>
        typeof credential.redactedSummary?.agentKind === "string"
          ? credential.redactedSummary.agentKind
          : ""
      ),
  );
}

export function resolveCloudHarnessAvailability(input: {
  catalogAgentKinds?: readonly string[] | null;
  allowedAgentKinds?: readonly string[] | null;
  readyAgentKinds?: readonly string[] | null;
  agentGateway?: CloudAgentGatewayCapabilitiesLike | null;
  fallbackAgentKinds?: readonly string[] | null;
  assumeFallbackAgentKindsLaunchable?: boolean;
}): CloudHarnessAvailability {
  const catalogAgentKinds = normalizeCloudAgentKindList(input.catalogAgentKinds);
  const allowedAgentKinds = normalizeCloudAgentKindList(input.allowedAgentKinds);
  const readyAgentKinds = normalizeCloudAgentKindList(input.readyAgentKinds);
  const fallbackAgentKinds = normalizeCloudAgentKindList(
    input.fallbackAgentKinds ?? DEFAULT_CLOUD_LAUNCHABLE_AGENT_KINDS,
  );
  const gateway = input.agentGateway;
  const gatewayKnown = gateway !== undefined;
  const managedCreditsEnabled = Boolean(
    gateway?.enabled
      && (
        gateway.managedCreditsPersonalEnabled
        || gateway.managedCreditsOrganizationEnabled
      ),
  );
  const managedCreditAgentKinds = managedCreditsEnabled
    ? normalizeCloudAgentKindList(gateway?.managedCreditAgentKinds)
    : [];

  const launchable = new Set<string>(readyAgentKinds);
  for (const kind of managedCreditAgentKinds) {
    launchable.add(kind);
  }
  if ((!gatewayKnown || input.assumeFallbackAgentKindsLaunchable) && launchable.size === 0) {
    for (const kind of fallbackAgentKinds) {
      launchable.add(kind);
    }
  }

  const catalog = catalogAgentKinds.length > 0
    ? new Set(catalogAgentKinds)
    : new Set(CLOUD_AGENT_KIND_ORDER);
  const allowed = new Set(
    (allowedAgentKinds.length > 0 ? allowedAgentKinds : CLOUD_AGENT_KIND_ORDER)
      .filter((kind) => catalog.has(kind)),
  );
  const ready = new Set(readyAgentKinds);
  const launchableAgentKinds = CLOUD_AGENT_KIND_ORDER
    .filter((kind) => allowed.has(kind) && launchable.has(kind))
    .filter((kind) => kind !== "opencode" || ready.has(kind) || Boolean(gateway?.opencodeGatewayEnabled));
  const launchableSet = new Set(launchableAgentKinds);
  const unavailableAgentKinds = CLOUD_AGENT_KIND_ORDER.flatMap((kind) => {
    if (!allowed.has(kind) || launchableSet.has(kind)) {
      return [];
    }
    return [{
      agentKind: kind,
      label: cloudAgentKindLabel(kind),
      reason: unavailableCloudHarnessReason({
        agentKind: kind,
        gateway,
        ready: ready.has(kind),
        managedCreditsEnabled,
      }),
    }];
  });

  return {
    launchableAgentKinds,
    unavailableAgentKinds,
    message: launchableAgentKinds.length > 0
      ? null
      : cloudHarnessUnavailableMessage({ gateway, gatewayKnown, unavailableAgentKinds }),
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

export function cloudAgentKindLabel(agentKind: string): string {
  switch (agentKind) {
    case "claude":
      return "Claude";
    case "codex":
      return "Codex";
    case "gemini":
      return "Gemini";
    case "opencode":
      return "OpenCode";
    default:
      return agentKind;
  }
}

function cloudAgentKindSortIndex(agentKind: string): number {
  const index = CLOUD_AGENT_KIND_ORDER.indexOf(agentKind as never);
  return index >= 0 ? index : CLOUD_AGENT_KIND_ORDER.length;
}

function unavailableCloudHarnessReason(input: {
  agentKind: string;
  gateway?: CloudAgentGatewayCapabilitiesLike | null;
  ready: boolean;
  managedCreditsEnabled: boolean;
}): CloudHarnessUnavailableReason {
  if (input.agentKind === "opencode" && !input.ready && !input.gateway?.opencodeGatewayEnabled) {
    return "opencode_gateway_disabled";
  }
  if (!input.gateway?.enabled && !input.ready) {
    return "agent_gateway_disabled";
  }
  if (!input.managedCreditsEnabled && !input.ready) {
    return "managed_credits_disabled";
  }
  return "missing_agent_auth";
}

function cloudHarnessUnavailableMessage(input: {
  gateway?: CloudAgentGatewayCapabilitiesLike | null;
  gatewayKnown: boolean;
  unavailableAgentKinds: readonly CloudHarnessUnavailableView[];
}): string {
  if (!input.gatewayKnown) {
    return "Checking cloud agent availability.";
  }
  if (!input.gateway?.enabled) {
    return "Agent Gateway is disabled. Configure a synced agent credential or enable managed credits before starting a new cloud session.";
  }
  if (input.unavailableAgentKinds.some((item) => item.reason === "opencode_gateway_disabled")) {
    return "OpenCode gateway support is disabled. Choose Claude or Codex, or enable OpenCode gateway support before launching it.";
  }
  if (input.unavailableAgentKinds.some((item) => item.reason === "managed_credits_disabled")) {
    return "Managed cloud agent credits are not enabled for this account. Configure agent auth before starting a cloud session.";
  }
  return "No cloud agent authentication is ready for this workspace. Configure Claude or Codex auth before starting a new session.";
}
