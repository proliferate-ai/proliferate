/**
 * Integration fixture for T3-INT-1
 * (specs/developing/testing/scenarios.md#T3-INT-1).
 *
 * The contract calls for "a real cataloged api_key-kind integration
 * definition" authenticated with a real key, then used by every harness
 * through the integration gateway.
 *
 * Finding surfaced while building this (2026-07-08): the contract's suggested
 * example — "Slack bot token stored as the api_key credential" — does NOT match
 * the shipped catalog. In `server/proliferate/server/cloud/integrations/seeds.py`
 * the Slack seed is `auth_kind="oauth2"` (the official hosted MCP at
 * https://mcp.slack.com/mcp), so a Slack *bot token* cannot be stored as an
 * api_key credential for the cataloged Slack definition, and connecting Slack
 * requires the OAuth dance the runner explicitly avoids. Filed as
 * https://github.com/proliferate-ai/proliferate/issues/1030 (found while
 * building tier-3 T3-INT-1). The real api_key-kind seed definitions are the
 * set below. T3-INT-1 therefore authenticates one of
 * those for real; `RELEASE_E2E_SLACK_BOT_TOKEN` is still declared in the
 * manifest per the build task, but it is not usable against the cataloged
 * Slack definition as-shipped (documented there and in the scenario).
 */

/**
 * Seed integrations whose `auth_kind` is `api_key` (verified against
 * `seeds.py` on this branch). A tool call through the gateway for these is a
 * real outbound MCP request to the named hosted server.
 */
export const API_KEY_INTEGRATION_NAMESPACES: readonly string[] = [
  "context7",
  "exa",
  "tavily",
  "render",
  "neon",
] as const;

/** Default when `RELEASE_E2E_INTEGRATION_NAMESPACE` is unset. Exa is a hosted
 * search MCP whose key is free to mint and whose tool call (a web search) has
 * no side effects, making it the cheapest safe real-tool-call target. */
export const DEFAULT_INTEGRATION_NAMESPACE = "exa";

export class InvalidIntegrationNamespaceError extends Error {
  constructor(namespace: string) {
    super(
      `Integration namespace "${namespace}" is not a cataloged api_key-kind seed integration. ` +
        `T3-INT-1 requires one of: ${API_KEY_INTEGRATION_NAMESPACES.join(", ")}. ` +
        `(Slack is cataloged as oauth2/hosted-MCP, not api_key — see src/fixtures/integrations.ts.)`,
    );
    this.name = "InvalidIntegrationNamespaceError";
  }
}

/**
 * Resolves the api_key-kind integration namespace to authenticate, validating
 * it is actually an api_key seed. Pure (source is passed in) so it is
 * unit-testable without process env.
 */
export function resolveIntegrationNamespace(source: NodeJS.ProcessEnv = process.env): string {
  const raw = source.RELEASE_E2E_INTEGRATION_NAMESPACE?.trim();
  const namespace = raw && raw.length > 0 ? raw : DEFAULT_INTEGRATION_NAMESPACE;
  if (!API_KEY_INTEGRATION_NAMESPACES.includes(namespace)) {
    throw new InvalidIntegrationNamespaceError(namespace);
  }
  return namespace;
}
