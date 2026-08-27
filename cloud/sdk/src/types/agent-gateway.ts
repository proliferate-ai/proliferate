import type { Schema } from "./schema.js";

export type AgentApiKey = Schema<"AgentApiKeyResponse">;
export type CreateAgentApiKeyRequest = Schema<"AgentApiKeyCreateRequest">;

export type AgentAuthSelection = Schema<"AgentAuthSelectionResponse">;
export type AgentAuthSource = Schema<"AgentAuthSourceInput">;
export type PutAuthSelectionsRequest = Schema<"AgentAuthSelectionsPutRequest">;
export type AgentAuthSurface = AgentAuthSelection["surface"];
export type AgentAuthSourceKind = AgentAuthSelection["sourceKind"];

export type AgentAuthState = Schema<"AgentAuthStateResponse">;
export type AgentAuthStateHarness = Schema<"AgentAuthStateHarness">;
export type AgentAuthStateSource = Schema<"AgentAuthStateSource">;

// Delivery acknowledgement (agent-auth.md "Applied means acknowledged"): the
// desktop echoes the pushed document's (sequence, fingerprint) after its
// local runtime confirmed the state push; the selections read derives
// applied-vs-pending from the stored stamp.
export type AckAgentAuthStateRequest = Schema<"AgentAuthStateAckRequest">;
export type AgentAuthDeliveryAck = Schema<"AgentAuthDeliveryAckResponse">;

// The courier's limit-hit relay body (agent_auth spec §4, POST
// /seats/{key_id}/limit-hit), derived from the regenerated OpenAPI schema.
export type ReportSeatLimitHitRequest = Schema<"AgentSeatLimitHitRequest">;

export type AgentGatewayCapabilities = Schema<"AgentGatewayCapabilitiesResponse">;
export type AgentGatewayEnrollment = Schema<"AgentGatewayEnrollmentResponse">;

// Flow 5's soft signal (agent_auth spec §2/§3, slice 4 meters): the latest
// usage-probe sample per seat — 0..1 utilization fractions, ISO reset
// instants, the binding window, and an honest `probe_failed` status when no
// trustworthy observation exists. Advisory only; never gates a launch.
export type SeatUsageSample = Schema<"SeatUsageSampleResponse">;

// The auth-selection route (native CLI login / a bound api_key row / the
// Proliferate gateway). This is a UI-selection concept, not a cloud-catalog
// wire field — the served model responses carry no route (and, after the
// composed re-key, no auth-context id either), so this union is declared
// directly rather than derived from a response schema.
export type AgentAuthRoute = "native" | "api_key" | "gateway";

// The composed cloud snapshot re-key (model-catalog.md §Cloud routes): the
// layered read/ingest/override routes live under /v1/cloud/agent-models/*,
// keyed by (owner, harness) alone — the former per-auth-context keying is
// deleted. `AgentModelSnapshotIngestRequest` and the old mirror/refresh
// product-mutation surface are deliberately NOT re-exported here: ingest is
// Worker-authenticated only (`authenticate_worker`), so no product client can
// call it — see F-040.
export type AgentModels = Schema<"AgentModelsResponse">;
export type AgentModelOverride = Schema<"AgentModelOverrideResponse">;
export type UpsertAgentModelOverrideRequest =
  Schema<"AgentModelOverrideUpsertRequest">;

export type OrgAgentPolicy = Schema<"OrgAgentPolicyResponse">;
export type UpdateOrgAgentPolicyRequest = Schema<"OrgAgentPolicyUpdateRequest">;
export type OrgAgentPolicyViolation = Schema<"OrgAgentPolicyViolation">;
export type OrgAgentPolicyViolationListResponse =
  Schema<"OrgAgentPolicyViolationListResponse">;
