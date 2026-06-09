import {
  enableSandboxProfileCloud,
  ensureFreeManagedCredits,
  ensurePersonalSandboxProfile,
  getCloudCapabilities,
  getSandboxAgentAuthSelections,
  listAgentAuthCredentials,
  putSandboxAgentAuthSelection,
  type AgentAuthAgentKind,
  type AgentGatewayCapabilities,
  type EnsureFreeManagedCreditsResponse,
  type ProliferateCloudClient,
} from "@proliferate/cloud-sdk";

export type PersonalAgentAuthLaunchReadiness =
  | {
    source: "selected_credential";
  }
  | {
    source: "free_credits";
    result: EnsureFreeManagedCreditsResponse;
  };

export async function ensurePersonalAgentAuthLaunchReady(args: {
  client: ProliferateCloudClient;
  agentKind: AgentAuthAgentKind | null;
  modelId?: string | null;
  allowUnavailableFreeCredits?: boolean;
  onStatus?: (status: string) => void;
}): Promise<PersonalAgentAuthLaunchReadiness> {
  if (args.agentKind && await ensureReadyPersonalSelectionWithRetry(args.client, args.agentKind)) {
    args.onStatus?.("Using selected cloud agent credential.");
    await ensurePersonalCloudTargetReady(args.client);
    return { source: "selected_credential" };
  }

  args.onStatus?.("Preparing cloud session.");
  const result = await ensureFreeManagedCreditsWithRetry(args);
  if (!result.launchEnabled && !freeCreditFailureCanFallThrough(result, args.allowUnavailableFreeCredits)) {
    throw new Error(
      result.lastErrorMessage
        ?? (result.status === "gateway_disabled"
          ? "Cloud agent launch is disabled for this account."
          : "Cloud agent credits are not ready yet. Please retry in a moment."),
    );
  }
  await ensurePersonalCloudTargetReady(args.client);
  return { source: "free_credits", result };
}

async function ensurePersonalCloudTargetReady(
  client: ProliferateCloudClient,
): Promise<void> {
  await withRecoverableRetry(async () => {
    const profile = await ensurePersonalSandboxProfile(client);
    await enableSandboxProfileCloud(profile.id, client);
  });
}

async function ensureReadyPersonalSelectionWithRetry(
  client: ProliferateCloudClient,
  agentKind: AgentAuthAgentKind,
): Promise<boolean> {
  return withRecoverableRetry(() => ensureReadyPersonalSelection(client, agentKind));
}

async function ensureReadyPersonalSelection(
  client: ProliferateCloudClient,
  agentKind: AgentAuthAgentKind,
): Promise<boolean> {
  const profile = await ensurePersonalSandboxProfile(client);
  const [selections, credentials, capabilities] = await Promise.all([
    getSandboxAgentAuthSelections(profile.id, client),
    listAgentAuthCredentials({}, client),
    getCloudCapabilities(client),
  ]);
  const selectedCredentials = selections
    .filter((selection) => selection.agentKind === agentKind && selection.status === "active")
    .map((selection) => ({
      authSlotId: selection.authSlotId,
      credential: credentials.find((credential) => credential.id === selection.credentialId),
    }));
  if (selectedCredentials.some(({ authSlotId, credential }) =>
    isReadyCredentialForSlot(
      credential,
      agentKind,
      authSlotForAgent(capabilities.agentGateway, agentKind, authSlotId),
      capabilities.agentGateway.enabled,
    )
  )) {
    return true;
  }

  const authSlot = primaryAuthSlotForAgent(capabilities.agentGateway, agentKind);
  const credential = readyCredentialForSlot(
    credentials,
    agentKind,
    authSlot,
    capabilities.agentGateway.enabled,
  );
  if (!credential) {
    return false;
  }
  await putSandboxAgentAuthSelection(
    profile.id,
    agentKind,
    authSlot.authSlotId,
    { credentialId: credential.id },
    client,
  );
  return true;
}

function readyCredentialForSlot<T extends ReadySyncedCredentialCandidate>(
  credentials: readonly T[],
  agentKind: AgentAuthAgentKind,
  authSlot: LaunchAuthSlot,
  gatewayEnabled: boolean,
): T | null {
  return credentials.find((credential) =>
    isReadyCredentialForSlot(credential, agentKind, authSlot, gatewayEnabled)
  ) ?? null;
}

interface ReadySyncedCredentialCandidate {
  credentialKind?: string | null;
  credentialProviderId?: string | null;
  redactedSummary?: { agentKind?: unknown } | null;
  status?: string | null;
}

function isReadyCredentialForSlot<T extends ReadySyncedCredentialCandidate>(
  credential: T | null | undefined,
  agentKind: AgentAuthAgentKind,
  authSlot: LaunchAuthSlot,
  gatewayEnabled: boolean,
): credential is T {
  if (credential?.status !== "ready") {
    return false;
  }
  if (credential.credentialKind === "synced_path") {
    return authSlot.primary && credential.redactedSummary?.agentKind === agentKind;
  }
  return gatewayEnabled
    && credential.credentialKind === "managed_gateway"
    && authSlot.credentialProviderIds.includes(credential.credentialProviderId ?? "");
}

interface LaunchAuthSlot {
  authSlotId: string;
  credentialProviderIds: readonly string[];
  primary: boolean;
}

function primaryAuthSlotForAgent(
  gateway: AgentGatewayCapabilities,
  agentKind: AgentAuthAgentKind,
): LaunchAuthSlot {
  const slots = gateway.agentAuthSlots.filter((slot) => slot.agentKind === agentKind);
  const slot = slots.find((candidate) => candidate.primary) ?? slots[0];
  if (slot) {
    return {
      authSlotId: slot.authSlotId,
      credentialProviderIds: slot.credentialProviderIds,
      primary: slot.primary,
    };
  }
  if (agentKind === "claude") {
    return fallbackAuthSlot("anthropic");
  }
  if (agentKind === "gemini") {
    return fallbackAuthSlot("gemini");
  }
  return fallbackAuthSlot("openai");
}

function authSlotForAgent(
  gateway: AgentGatewayCapabilities,
  agentKind: AgentAuthAgentKind,
  authSlotId: string,
): LaunchAuthSlot {
  const slot = gateway.agentAuthSlots.find((candidate) =>
    candidate.agentKind === agentKind && candidate.authSlotId === authSlotId
  );
  if (slot) {
    return {
      authSlotId: slot.authSlotId,
      credentialProviderIds: slot.credentialProviderIds,
      primary: slot.primary,
    };
  }
  return fallbackAuthSlot(authSlotId);
}

function fallbackAuthSlot(authSlotId: string): LaunchAuthSlot {
  return {
    authSlotId,
    credentialProviderIds: [authSlotId],
    primary: true,
  };
}

async function ensureFreeManagedCreditsWithRetry(args: {
  client: ProliferateCloudClient;
  agentKind: AgentAuthAgentKind | null;
  modelId?: string | null;
}): Promise<EnsureFreeManagedCreditsResponse> {
  return withRecoverableRetry(() =>
    ensureFreeManagedCredits({
      agentKind: args.agentKind,
      modelId: args.modelId,
    }, args.client)
  );
}

async function withRecoverableRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown = null;
  for (const delayMs of [0, 500, 1_250]) {
    if (delayMs > 0) {
      await sleep(delayMs);
    }
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRecoverableLaunchReadinessError(error)) {
        throw error;
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Cloud agent launch readiness could not be checked.");
}

function isRecoverableLaunchReadinessError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /\b(failed to fetch|network|load failed|connection|aborted|timeout|timed out)\b/i
    .test(message);
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function freeCreditFailureCanFallThrough(
  result: EnsureFreeManagedCreditsResponse,
  allowUnavailableFreeCredits: boolean | undefined,
): boolean {
  return Boolean(allowUnavailableFreeCredits)
    && (result.status === "not_entitled" || result.status === "gateway_disabled");
}
