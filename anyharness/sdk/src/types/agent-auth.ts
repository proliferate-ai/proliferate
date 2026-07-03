import type { components } from "../generated/openapi.js";

export type ApplyAgentAuthStateResponse =
  components["schemas"]["ApplyAgentAuthStateResponse"];

/**
 * One credential source in the agent-auth state.json v2 contract
 * (`route_auth/state.rs`, snake_case on the wire). The runtime accepts the
 * document verbatim as the PUT /v1/agent-auth/state body, so it is typed here
 * rather than in the generated OpenAPI surface.
 */
export interface AgentAuthStateSource {
  kind: "gateway" | "api_key";
  base_url?: string | null;
  key?: string | null;
  env_var_name?: string | null;
  value?: string | null;
}

/** One harness's enabled sources in the state.json v2 document. */
export interface AgentAuthStateHarness {
  harness_kind: string;
  sources: AgentAuthStateSource[];
}

/** The whole state.json v2 document (`route_auth/state.rs::AgentAuthState`). */
export interface AgentAuthStateDocument {
  version: number;
  revision: number;
  user_id?: string | null;
  harnesses: AgentAuthStateHarness[];
}
