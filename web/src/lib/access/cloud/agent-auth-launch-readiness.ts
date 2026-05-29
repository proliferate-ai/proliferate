import {
  enableSandboxProfileCloud,
  ensureFreeManagedCredits,
  ensurePersonalSandboxProfile,
  getSandboxAgentAuthSelections,
  listAgentAuthCredentials,
  putSandboxAgentAuthSelection,
  type AgentAuthAgentKind,
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
  if (args.agentKind && await ensureReadyPersonalSyncedSelectionWithRetry(args.client, args.agentKind)) {
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

async function ensureReadyPersonalSyncedSelectionWithRetry(
  client: ProliferateCloudClient,
  agentKind: AgentAuthAgentKind,
): Promise<boolean> {
  return withRecoverableRetry(() => ensureReadyPersonalSyncedSelection(client, agentKind));
}

async function ensureReadyPersonalSyncedSelection(
  client: ProliferateCloudClient,
  agentKind: AgentAuthAgentKind,
): Promise<boolean> {
  const profile = await ensurePersonalSandboxProfile(client);
  const [selections, credentials] = await Promise.all([
    getSandboxAgentAuthSelections(profile.id, client),
    listAgentAuthCredentials({ agentKind }, client),
  ]);
  const selection = selections.find((candidate) =>
    candidate.agentKind === agentKind && candidate.status === "active"
  );
  if (!selection) {
    const syncedCredential = readySyncedCredential(credentials);
    if (!syncedCredential) {
      return false;
    }
    await putSandboxAgentAuthSelection(
      profile.id,
      agentKind,
      { credentialId: syncedCredential.id },
      client,
    );
    return true;
  }
  const credential = credentials.find((candidate) => candidate.id === selection.credentialId);
  if (isReadySyncedCredential(credential)) {
    return true;
  }
  const syncedCredential = readySyncedCredential(credentials);
  if (!syncedCredential) {
    return false;
  }
  await putSandboxAgentAuthSelection(
    profile.id,
    agentKind,
    { credentialId: syncedCredential.id },
    client,
  );
  return true;
}

function readySyncedCredential<T extends { credentialKind?: string | null; status?: string | null }>(
  credentials: readonly T[],
): T | null {
  return credentials.find(isReadySyncedCredential) ?? null;
}

function isReadySyncedCredential<T extends { credentialKind?: string | null; status?: string | null }>(
  credential: T | null | undefined,
): credential is T {
  return credential?.status === "ready" && credential.credentialKind === "synced_path";
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
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

function freeCreditFailureCanFallThrough(
  result: EnsureFreeManagedCreditsResponse,
  allowUnavailableFreeCredits: boolean | undefined,
): boolean {
  return Boolean(allowUnavailableFreeCredits)
    && (result.status === "not_entitled" || result.status === "gateway_disabled");
}
