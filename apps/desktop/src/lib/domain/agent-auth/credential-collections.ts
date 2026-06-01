import type { AgentAuthCredential } from "@proliferate/cloud-sdk";

export function groupAgentAuthCredentialsByAgent(credentials: AgentAuthCredential[]) {
  const grouped = new Map<string, AgentAuthCredential[]>();
  for (const credential of credentials) {
    const entries = grouped.get(credential.agentKind) ?? [];
    entries.push(credential);
    grouped.set(credential.agentKind, entries);
  }
  return grouped;
}
