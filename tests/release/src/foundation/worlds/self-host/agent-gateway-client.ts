/**
 * Thin client for the product's own agent-gateway "key vault" HTTP surface
 * (`server/proliferate/server/cloud/agent_gateway/api.py`, mounted at
 * `{apiPrefix}/v1/cloud/agent-gateway/*`). `SH-BASE-TURN` stores its
 * run-scoped user API key and selects it for a harness through this real
 * product path — never by writing to the database directly.
 *
 * `GET /state?surface=local` returns the caller's own decrypted key material
 * for the local surface — the exact document a packaged Desktop fetches and
 * pushes to its local AnyHarness runtime (see that route's docstring). This
 * client fetches the same document so the self-host slice can push it to the
 * run-scoped local AnyHarness process started by `local-anyharness.ts`,
 * faithfully reproducing the product's real materialization path without a
 * browser-driven Desktop UI (a recorded, intentional narrowing for this
 * slice — see `journey.ts`).
 */

export interface AgentApiKeyResponse {
  id: string;
  title: string;
  redactedHint: string;
  status: string;
  createdAt: string;
}

export interface AgentAuthStateSource {
  kind: "gateway" | "api_key";
  base_url?: string | null;
  key?: string | null;
  env_var_name?: string | null;
  value?: string | null;
}

export interface AgentAuthStateHarness {
  harness_kind: string;
  sources: AgentAuthStateSource[];
}

export interface AgentAuthStateDocument {
  version: number;
  revision: number;
  user_id?: string | null;
  harnesses: AgentAuthStateHarness[];
}

export class AgentGatewayClient {
  private readonly baseUrl: string;
  private readonly bearerToken: string;

  constructor(params: { baseUrl: string; bearerToken: string }) {
    this.baseUrl = params.baseUrl.replace(/\/+$/, "");
    this.bearerToken = params.bearerToken;
  }

  /** Stores a run-scoped user API key through the product's own route. */
  async createApiKey(title: string, value: string): Promise<AgentApiKeyResponse> {
    return this.request<AgentApiKeyResponse>("POST", "/v1/cloud/agent-gateway/keys", { title, value });
  }

  async revokeApiKey(apiKeyId: string): Promise<AgentApiKeyResponse> {
    return this.request<AgentApiKeyResponse>("DELETE", `/v1/cloud/agent-gateway/keys/${apiKeyId}`);
  }

  /** Selects the stored key as the harness's sole desired source for one surface. */
  async selectApiKeyForHarness(harnessKind: string, surface: "local" | "cloud", apiKeyId: string): Promise<void> {
    await this.request(
      "PUT",
      `/v1/cloud/agent-gateway/selections/${harnessKind}?surface=${surface}`,
      { sources: [{ sourceKind: "api_key", apiKeyId, enabled: true }] },
    );
  }

  /** Fetches the caller's own rendered state.json v2 document for one surface. */
  async getState(surface: "local" | "cloud"): Promise<AgentAuthStateDocument> {
    return this.request<AgentAuthStateDocument>("GET", `/v1/cloud/agent-gateway/state?surface=${surface}`);
  }

  private async request<TResponse>(method: string, path: string, body?: unknown): Promise<TResponse> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.bearerToken}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const parsed = text.length > 0 ? safeJsonParse(text) : undefined;
    if (!response.ok) {
      throw new Error(`${method} ${path} -> ${response.status}: ${typeof parsed === "string" ? parsed : JSON.stringify(parsed)}`);
    }
    return parsed as TResponse;
  }
}

/** Pushes a state.json v2 document to a local AnyHarness runtime's own agent-auth endpoint. */
export async function pushAgentAuthState(runtimeBaseUrl: string, document: AgentAuthStateDocument): Promise<void> {
  const response = await fetch(`${runtimeBaseUrl}/v1/agent-auth/state`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(document),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`PUT ${runtimeBaseUrl}/v1/agent-auth/state -> ${response.status}: ${body}`);
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
