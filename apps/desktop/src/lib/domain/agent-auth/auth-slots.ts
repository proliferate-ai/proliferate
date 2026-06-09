import type {
  AgentAuthAgentKind,
  AgentAuthCredential,
  AgentAuthCredentialProviderId,
  AgentGatewayCapabilities,
  SandboxAgentAuthSelection,
} from "@proliferate/cloud-sdk";
import type { AgentAuthProvider } from "@/lib/access/tauri/credentials";
import { agentAuthAgentLabel } from "./agent-auth-agent-presentation";

export interface AgentAuthSlotDefinition {
  agentKind: AgentAuthAgentKind;
  authSlotId: AgentAuthCredentialProviderId | string;
  label: string;
  shortLabel: string;
  credentialProviderIds: readonly AgentAuthCredentialProviderId[];
  localProvider: AgentAuthProvider | null;
  primary: boolean;
}

const BUNDLED_AGENT_AUTH_SLOT_DEFINITIONS: AgentAuthSlotDefinition[] = [
  {
    agentKind: "claude",
    authSlotId: "anthropic",
    label: "Claude Anthropic",
    shortLabel: "Anthropic",
    credentialProviderIds: ["anthropic"],
    localProvider: "claude",
    primary: true,
  },
  {
    agentKind: "codex",
    authSlotId: "openai",
    label: "Codex OpenAI",
    shortLabel: "OpenAI",
    credentialProviderIds: ["openai"],
    localProvider: "codex",
    primary: true,
  },
  {
    agentKind: "opencode",
    authSlotId: "openai",
    label: "OpenCode OpenAI",
    shortLabel: "OpenAI",
    credentialProviderIds: ["openai"],
    localProvider: null,
    primary: true,
  },
  {
    agentKind: "opencode",
    authSlotId: "anthropic",
    label: "OpenCode Anthropic",
    shortLabel: "Anthropic",
    credentialProviderIds: ["anthropic"],
    localProvider: null,
    primary: false,
  },
  {
    agentKind: "opencode",
    authSlotId: "gemini",
    label: "OpenCode Gemini",
    shortLabel: "Gemini",
    credentialProviderIds: ["gemini"],
    localProvider: null,
    primary: false,
  },
  {
    agentKind: "gemini",
    authSlotId: "gemini",
    label: "Gemini",
    shortLabel: "Gemini",
    credentialProviderIds: ["gemini"],
    localProvider: "gemini",
    primary: true,
  },
];

const CLOUD_AUTH_AGENT_KINDS: readonly AgentAuthAgentKind[] = [
  "claude",
  "codex",
  "opencode",
  "gemini",
];

const CREDENTIAL_PROVIDER_IDS: readonly AgentAuthCredentialProviderId[] = [
  "anthropic",
  "openai",
  "gemini",
  "cursor",
];

const LOCAL_AGENT_AUTH_PROVIDERS: readonly AgentAuthProvider[] = [
  "claude",
  "codex",
  "gemini",
];

export function agentAuthSlotDefinitions(
  capabilities: AgentGatewayCapabilities | null | undefined,
): AgentAuthSlotDefinition[] {
  const slots = capabilities?.agentAuthSlots;
  if (!slots || slots.length === 0) {
    return BUNDLED_AGENT_AUTH_SLOT_DEFINITIONS;
  }
  const projected = slots.flatMap((slot) => {
    if (!isCloudAuthAgentKind(slot.agentKind)) {
      return [];
    }
    const credentialProviderIds = slot.credentialProviderIds.filter(isCredentialProviderId);
    if (credentialProviderIds.length === 0) {
      return [];
    }
    return [{
      agentKind: slot.agentKind,
      authSlotId: slot.authSlotId,
      label: slot.label,
      shortLabel: slot.shortLabel,
      credentialProviderIds,
      localProvider: isLocalAgentAuthProvider(slot.localProvider)
        ? slot.localProvider
        : null,
      primary: slot.primary,
    }];
  });
  return projected.length > 0 ? projected : BUNDLED_AGENT_AUTH_SLOT_DEFINITIONS;
}

export function agentAuthPrimarySlotForAgent(
  agentKind: AgentAuthAgentKind,
  capabilities?: AgentGatewayCapabilities | null,
): AgentAuthSlotDefinition {
  const slots = agentAuthSlotDefinitions(capabilities);
  return slots.find((slot) =>
    slot.agentKind === agentKind && slot.primary
  ) ?? slots.find((slot) => slot.agentKind === agentKind)!;
}

export function agentAuthSlotLabel(slot: AgentAuthSlotDefinition): string {
  const agentLabel = agentAuthAgentLabel(slot.agentKind);
  return slot.label.startsWith(agentLabel) ? slot.label : `${agentLabel} ${slot.shortLabel}`;
}

export function agentAuthCredentialProviderLabel(
  credentialProviderId: string | null | undefined,
): string {
  if (credentialProviderId === "anthropic") {
    return "Anthropic";
  }
  if (credentialProviderId === "openai") {
    return "OpenAI";
  }
  if (credentialProviderId === "gemini") {
    return "Gemini";
  }
  if (credentialProviderId === "cursor") {
    return "Cursor";
  }
  return credentialProviderId ?? "Provider";
}

export function agentAuthCredentialMatchesSlot(
  credential: AgentAuthCredential,
  slot: AgentAuthSlotDefinition,
): boolean {
  if (
    !slot.credentialProviderIds.includes(
      credential.credentialProviderId as AgentAuthCredentialProviderId,
    )
  ) {
    return false;
  }
  if (credential.credentialKind !== "synced_path") {
    return true;
  }
  return slot.primary && credential.redactedSummary.agentKind === slot.agentKind;
}

export function agentAuthCredentialProviderMatchesSlot(
  credential: AgentAuthCredential,
  slot: AgentAuthSlotDefinition,
): boolean {
  return slot.credentialProviderIds.includes(
    credential.credentialProviderId as AgentAuthCredentialProviderId,
  );
}

export function credentialsForAgentAuthSlot(
  credentials: readonly AgentAuthCredential[],
  slot: AgentAuthSlotDefinition,
): AgentAuthCredential[] {
  return credentials.filter((credential) =>
    agentAuthCredentialMatchesSlot(credential, slot)
  );
}

export function selectionByAgentAuthSlot(
  selections: readonly SandboxAgentAuthSelection[],
): Map<string, SandboxAgentAuthSelection> {
  return new Map(selections.map((selection) => [
    agentAuthSlotKey(selection.agentKind as AgentAuthAgentKind, selection.authSlotId),
    selection,
  ]));
}

export function agentAuthSlotKey(
  agentKind: AgentAuthAgentKind,
  authSlotId: string,
): string {
  return `${agentKind}:${authSlotId}`;
}

export function agentAuthSlotDomId(
  agentKind: AgentAuthAgentKind,
  authSlotId: string,
): string {
  return `agent-auth-${agentKind}-${authSlotId}`;
}

export function countConfiguredAgentAuthSlots(
  selections: readonly SandboxAgentAuthSelection[],
  credentials: readonly AgentAuthCredential[],
): number {
  const credentialIds = new Set(credentials.map((credential) => credential.id));
  return selections.filter((selection) =>
    credentialIds.has(selection.credentialId)
  ).length;
}

function isCloudAuthAgentKind(value: string): value is AgentAuthAgentKind {
  return CLOUD_AUTH_AGENT_KINDS.includes(value as AgentAuthAgentKind);
}

function isCredentialProviderId(value: string): value is AgentAuthCredentialProviderId {
  return CREDENTIAL_PROVIDER_IDS.includes(value as AgentAuthCredentialProviderId);
}

function isLocalAgentAuthProvider(value: string | null | undefined): value is AgentAuthProvider {
  return LOCAL_AGENT_AUTH_PROVIDERS.includes(value as AgentAuthProvider);
}
