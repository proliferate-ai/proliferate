import type { components } from "../generated/openapi.js";

export type ApplyAgentAuthStateResponse =
  components["schemas"]["ApplyAgentAuthStateResponse"];

/**
 * One rendered selection in the agent-auth state.json contract
 * (`route_auth/state.rs::AuthSelection`, snake_case on the wire). The runtime
 * accepts the document verbatim as the PUT /v1/agent-auth/state body, so it
 * is typed here rather than in the generated OpenAPI surface.
 */
export interface AgentAuthStateSelection {
  harness: string;
  route: "native" | "api_key" | "gateway";
  slot: string;
  provider?: string | null;
  base_url?: string | null;
  key?: string | null;
  model_catalog?: string[] | null;
}

/** The whole state.json document (`route_auth/state.rs::AgentAuthState`). */
export interface AgentAuthStateDocument {
  revision: number;
  user_id: string;
  selections: AgentAuthStateSelection[];
}
