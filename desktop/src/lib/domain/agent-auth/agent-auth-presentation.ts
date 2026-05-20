import type {
  AgentAuthAgentKind,
  AgentAuthCredential,
  SandboxAgentAuthSelection,
  SandboxAgentAuthTargetState,
} from "@proliferate/cloud-sdk";

export type AgentAuthBadgeTone = "neutral" | "success" | "warning" | "destructive";

export const AGENT_AUTH_AGENT_ORDER: AgentAuthAgentKind[] = [
  "claude",
  "codex",
  "opencode",
  "gemini",
];

export function agentAuthAgentLabel(agentKind: string): string {
  if (agentKind === "claude") {
    return "Claude Code";
  }
  if (agentKind === "codex") {
    return "Codex";
  }
  if (agentKind === "opencode") {
    return "OpenCode";
  }
  if (agentKind === "gemini") {
    return "Gemini";
  }
  return agentKind;
}

export function agentAuthCredentialKindLabel(credential: AgentAuthCredential): string {
  if (credential.credentialKind === "managed_gateway") {
    const providerKind = credential.redactedSummary.providerKind;
    if (providerKind === "proliferate_bedrock_pool") {
      return "Proliferate managed credits";
    }
    if (providerKind === "bedrock_assume_role") {
      return "AWS Bedrock role";
    }
    if (providerKind === "anthropic_api_key") {
      return "Anthropic API key";
    }
    if (providerKind === "openai_api_key") {
      return "OpenAI API key";
    }
    if (providerKind === "openai_compatible") {
      return "OpenAI-compatible provider";
    }
    return "Gateway credential";
  }
  if (credential.credentialKind === "synced_path") {
    return `Synced ${agentAuthAgentLabel(credential.agentKind)} auth`;
  }
  return credential.credentialKind;
}

export function agentAuthCredentialOwnerLabel(credential: AgentAuthCredential): string {
  if (credential.ownerScope === "system") {
    return "System";
  }
  if (credential.ownerScope === "organization") {
    return "Organization";
  }
  return "Personal";
}

export function agentAuthCredentialStatusTone(status: string): AgentAuthBadgeTone {
  if (status === "ready" || status === "active" || status === "applied") {
    return "success";
  }
  if (status === "pending" || status === "materializing") {
    return "warning";
  }
  if (status === "revoked" || status === "invalid" || status === "failed") {
    return "destructive";
  }
  return "neutral";
}

export function agentAuthCredentialStatusLabel(status: string): string {
  if (status === "needs_resync") {
    return "Needs resync";
  }
  return status.replaceAll("_", " ");
}

export function describeAgentAuthCredential(credential: AgentAuthCredential): string {
  const details = credentialSummaryDetails(credential);
  const owner = agentAuthCredentialOwnerLabel(credential);
  return details ? `${owner} · ${details}` : owner;
}

export function credentialSummaryDetails(credential: AgentAuthCredential): string {
  const summary = credential.redactedSummary;
  if (typeof summary.roleArn === "string" && typeof summary.region === "string") {
    return `${summary.roleArn} · ${summary.region}`;
  }
  if (typeof summary.baseUrl === "string") {
    return summary.baseUrl;
  }
  if (typeof summary.apiKey === "string") {
    return summary.apiKey;
  }
  if (typeof summary.authMode === "string") {
    return `Synced ${summary.authMode}`;
  }
  return "";
}

export function credentialSelectableReason(
  credential: AgentAuthCredential,
  profileOwnerScope: string,
): string | null {
  if (credential.status !== "ready") {
    return `Credential is ${agentAuthCredentialStatusLabel(credential.status)}.`;
  }
  if (
    profileOwnerScope === "organization"
    && credential.ownerScope === "personal"
    && credential.credentialKind === "synced_path"
    && !credential.activeCredentialShareId
  ) {
    return "Personal synced credentials need an active owner share before shared sandbox selection.";
  }
  return null;
}

export function selectionByAgentKind(
  selections: SandboxAgentAuthSelection[],
): Map<string, SandboxAgentAuthSelection> {
  return new Map(selections.map((selection) => [selection.agentKind, selection]));
}

export function targetStateSummary(
  states: SandboxAgentAuthTargetState[],
  targetId: string,
): SandboxAgentAuthTargetState | null {
  return states.find((state) => state.targetId === targetId) ?? null;
}
