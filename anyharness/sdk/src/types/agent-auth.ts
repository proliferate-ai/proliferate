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
  kind: "gateway" | "api_key" | "provider_config" | "seat";
  base_url?: string | null;
  key?: string | null;
  env_var_name?: string | null;
  value?: string | null;
  /**
   * `provider_config` sources only (Track D, `route_auth/state.rs`
   * `AuthSource`): the typed vault kind plus the harness's already-resolved
   * env map — the runtime `.set()`s the exact keys, never renaming. Narrowed
   * to the known vault kinds here (the Rust side keeps a raw string, same as
   * `kind`) to mirror the server's wire vocabulary.
   */
  config_kind?: "aws_bedrock" | "azure_openai" | null;
  /** `provider_config` and `seat`: the harness's already-resolved env map. */
  env?: Record<string, string> | null;
  /** `seat` sources only (seats v1): the vault entry id, never key material. */
  seat_id?: string | null;
}

/** One harness's enabled sources in the state.json v2 document. */
export interface AgentAuthStateHarness {
  harness_kind: string;
  sources: AgentAuthStateSource[];
}

/** The whole state.json v2 document (`route_auth/state.rs::AgentAuthState`). */
export interface AgentAuthStateDocument {
  version: number;
  /**
   * Monotonic per (user, surface), bumped only by a render whose `harnesses`
   * content changed (agent_auth spec §2, "How delivery is governed"). This is
   * the ORDERING field: the runtime rejects a push whose sequence is below the
   * one it persisted. The change-detection value is `fingerprint`, which is a
   * `GET /state` rider and never appears in this document.
   */
  sequence: number;
  /**
   * The identity of the counter `sequence` counts in: the server's
   * render-sequence row uuid, minted when the row was created and never
   * updated — a rebuilt or switched server database is a new lineage. The
   * runtime refuses a push whose lineage differs from its persisted one
   * (409, code `AGENT_ROUTE_STATE_LINEAGE`); only an explicit reset (the
   * state DELETE) adopts a new lineage. The courier carries it verbatim and
   * never interprets it.
   */
  lineage: string;
  user_id?: string | null;
  /**
   * The origin (`scheme://host[:port]`) of the control-plane server that
   * produced this document. The desktop write path stamps this at push time
   * so the runtime's render plane can detect a document left over from a
   * server the app is no longer pointed at and skip injecting its gateway
   * credentials. Omit for cloud-materialized state, where there is no
   * server-switch concern.
   */
  issuing_server_origin?: string | null;
  harnesses: AgentAuthStateHarness[];
}
