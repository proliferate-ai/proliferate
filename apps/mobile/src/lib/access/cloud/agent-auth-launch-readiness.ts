import {
  enableSandboxProfileCloud,
  ensureFreeManagedCredits,
  ensurePersonalSandboxProfile,
  getSandboxAgentAuthSelections,
  listAgentAuthCredentials,
  putSandboxAgentAuthSelection,
  type AgentAuthAgentKind,
  type AgentAuthCredentialProviderId,
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
  const authSlotId = defaultAuthSlotIdForAgent(agentKind);
  const profile = await ensurePersonalSandboxProfile(client);
  const [selections, credentials] = await Promise.all([
    getSandboxAgentAuthSelections(profile.id, client),
    listAgentAuthCredentials({}, client),
  ]);
  const selectedCredentials = selections
    .filter((selection) => selection.agentKind === agentKind && selection.status === "active")
    .map((selection) => credentials.find((credential) => credential.id === selection.credentialId));
  if (selectedCredentials.some((credential) => isReadyLaunchCredential(credential, agentKind))) {
    return true;
  }

  const syncedCredential = readySyncedCredential(credentials, agentKind);
  if (!syncedCredential) {
    return false;
  }
  await putSandboxAgentAuthSelection(
    profile.id,
    agentKind,
    authSlotId,
    { credentialId: syncedCredential.id },
    client,
  );
  return true;
}

function readySyncedCredential<T extends ReadySyncedCredentialCandidate>(
  credentials: readonly T[],
  agentKind: AgentAuthAgentKind,
): T | null {
  return credentials.find((credential) => isReadySyncedCredential(credential, agentKind)) ?? null;
}

interface ReadySyncedCredentialCandidate {
  credentialKind?: string | null;
  redactedSummary?: { agentKind?: unknown } | null;
  status?: string | null;
}

function isReadyLaunchCredential<T extends ReadySyncedCredentialCandidate>(
  credential: T | null | undefined,
  agentKind: AgentAuthAgentKind,
): credential is T {
  if (credential?.status !== "ready") {
    return false;
  }
  if (credential.credentialKind === "synced_path") {
    return credential.redactedSummary?.agentKind === agentKind;
  }
  return credential.credentialKind === "managed_gateway";
}

function isReadySyncedCredential<T extends ReadySyncedCredentialCandidate>(
  credential: T | null | undefined,
  agentKind: AgentAuthAgentKind,
): credential is T {
  return credential?.status === "ready"
    && credential.credentialKind === "synced_path"
    && credential.redactedSummary?.agentKind === agentKind;
}

function defaultAuthSlotIdForAgent(
  agentKind: AgentAuthAgentKind,
): AgentAuthCredentialProviderId {
  if (agentKind === "claude") {
    return "anthropic";
  }
  if (agentKind === "gemini") {
    return "gemini";
  }
  return "openai";
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
