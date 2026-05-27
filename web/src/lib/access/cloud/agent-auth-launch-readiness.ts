import {
  ensureFreeManagedCredits,
  ensurePersonalSandboxProfile,
  getSandboxAgentAuthSelections,
  listAgentAuthCredentials,
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
  if (args.agentKind && await hasReadyPersonalSelection(args.client, args.agentKind)) {
    args.onStatus?.("Using selected cloud agent credential.");
    return { source: "selected_credential" };
  }

  args.onStatus?.("Checking cloud agent credits.");
  const result = await ensureFreeManagedCredits({
    agentKind: args.agentKind,
    modelId: args.modelId,
  }, args.client);
  if (!result.launchEnabled && !freeCreditFailureCanFallThrough(result, args.allowUnavailableFreeCredits)) {
    throw new Error(
      result.lastErrorMessage
        ?? (result.status === "gateway_disabled"
          ? "Cloud agent launch is disabled for this account."
          : "Cloud agent credits are not ready yet. Please retry in a moment."),
    );
  }
  return { source: "free_credits", result };
}

async function hasReadyPersonalSelection(
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
    return false;
  }
  const credential = credentials.find((candidate) => candidate.id === selection.credentialId);
  return credential?.status === "ready";
}

function freeCreditFailureCanFallThrough(
  result: EnsureFreeManagedCreditsResponse,
  allowUnavailableFreeCredits: boolean | undefined,
): boolean {
  return Boolean(allowUnavailableFreeCredits)
    && (result.status === "not_entitled" || result.status === "gateway_disabled");
}
