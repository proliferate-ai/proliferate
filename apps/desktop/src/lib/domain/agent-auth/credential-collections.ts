import type { AgentAuthCredential } from "@proliferate/cloud-sdk";

export function groupAgentAuthCredentialsByProvider(credentials: AgentAuthCredential[]) {
  const grouped = new Map<string, AgentAuthCredential[]>();
  for (const credential of credentials) {
    const entries = grouped.get(credential.credentialProviderId) ?? [];
    entries.push(credential);
    grouped.set(credential.credentialProviderId, entries);
  }
  return grouped;
}
