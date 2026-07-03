import type { AgentApiKey, AgentAuthRouteSelection } from "@proliferate/cloud-sdk";
import {
  agentApiKeyProviderLabel,
} from "@/config/agent-api-key-providers";

// One (harness, surface, slot) route selection that points at an API key.
export interface ApiKeyUsage {
  harnessKind: string;
  surface: "local" | "cloud";
  slot: string;
}

// Mirrors displayName per kind in catalogs/agents/catalog.json.
const HARNESS_LABELS: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  grok: "Grok",
  opencode: "OpenCode",
};

export function harnessDisplayLabel(harnessKind: string): string {
  return HARNESS_LABELS[harnessKind] ?? harnessKind;
}

export function usagesForApiKey(
  apiKeyId: string,
  selections: readonly AgentAuthRouteSelection[],
): ApiKeyUsage[] {
  return selections
    .filter((selection) => selection.route === "api_key" && selection.apiKeyId === apiKeyId)
    .map(({ harnessKind, surface, slot }) => ({ harnessKind, surface, slot }))
    .sort((a, b) =>
      a.harnessKind.localeCompare(b.harnessKind)
      || a.surface.localeCompare(b.surface)
      || a.slot.localeCompare(b.slot));
}

// "Claude (local)"; opencode composed slots carry the provider: "OpenCode (cloud, Anthropic)".
export function formatApiKeyUsage(usage: ApiKeyUsage): string {
  const qualifiers = [usage.surface as string];
  if (usage.slot !== "primary") {
    qualifiers.push(agentApiKeyProviderLabel(usage.slot));
  }
  return `${harnessDisplayLabel(usage.harnessKind)} (${qualifiers.join(", ")})`;
}

export function formatApiKeyUsages(usages: readonly ApiKeyUsage[]): string {
  if (usages.length === 0) {
    return "Not used by any agent";
  }
  return `Used by ${usages.map(formatApiKeyUsage).join(", ")}`;
}

export function buildRevokeConfirmation(
  key: AgentApiKey,
  usages: readonly ApiKeyUsage[],
): string {
  if (usages.length === 0) {
    return `Revoke ${key.displayName}? The secret is deleted and cannot be recovered.`;
  }
  const routes = usages.map(formatApiKeyUsage).join(", ");
  return `Revoke ${key.displayName}? It is used by ${routes}. `
    + "Those routes will stop working until you pick another key.";
}

export function formatLastValidated(lastValidatedAt: string | null): string {
  if (lastValidatedAt === null) {
    return "Never validated";
  }
  const date = new Date(lastValidatedAt);
  if (Number.isNaN(date.getTime())) {
    return "Never validated";
  }
  return `Last validated ${date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}
