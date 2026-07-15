/**
 * Pushes a gateway-keyed agent-auth state document to the LOCAL AnyHarness
 * runtime (`PUT /v1/agent-auth/state`, the state.json v2 contract in
 * anyharness/crates/anyharness-lib/src/domains/agents/route_auth/state.rs) so
 * harnesses can drive real chat through the LiteLLM gateway in an environment
 * with no native agent CLI login (the CI runner). This is the same document
 * the desktop dispatch worker pushes after fetching
 * `GET /agent-gateway/state?surface=local` — the runner composes it directly
 * from RELEASE_E2E_GATEWAY_TEST_KEY + RELEASE_E2E_GATEWAY_BASE_URL because the
 * ephemeral CI server has no gateway plane of its own (agent_gateway_enabled
 * defaults off; there is no local LiteLLM).
 *
 * Revision uses the current epoch millis: the contract only requires a
 * monotonic value for stale-push protection, and the CI runtime home is fresh
 * per run (a laptop rerun also always moves forward in time).
 */

const GATEWAY_HARNESSES = ["claude", "codex", "cursor", "grok", "opencode"] as const;

export async function pushGatewayAuthState(params: {
  runtimeUrl: string;
  gatewayBaseUrl: string;
  gatewayKey: string;
}): Promise<void> {
  const document = {
    version: 2,
    revision: Date.now(),
    harnesses: GATEWAY_HARNESSES.map((harnessKind) => ({
      harness_kind: harnessKind,
      sources: [{ kind: "gateway", base_url: params.gatewayBaseUrl, key: params.gatewayKey }],
    })),
  };
  const response = await fetch(`${params.runtimeUrl}/v1/agent-auth/state`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(document),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`PUT /v1/agent-auth/state -> ${response.status}: ${body}`);
  }
}
