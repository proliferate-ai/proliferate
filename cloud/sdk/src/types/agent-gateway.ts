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

export type AgentGatewayCapabilities = Schema<"AgentGatewayCapabilitiesResponse">;
export type AgentGatewayEnrollment = Schema<"AgentGatewayEnrollmentResponse">;

// The auth-selection route (native CLI login / a bound api_key row / the
// Proliferate gateway). This is a UI-selection concept, not a cloud-catalog
// wire field: model-catalog.md's B4 re-key dropped `route` from the served
// catalog response entirely in favor of `authContextId` (see below), so this
// union is now declared directly rather than derived from a response schema.
export type AgentAuthRoute = "native" | "api_key" | "gateway";

// The B4 cloud snapshot re-key (model-catalog.md §Cloud routes): the layered
// read/ingest/override routes moved from /v1/cloud/agent-gateway/catalog/* to
// /v1/cloud/agent-models/*, keyed by the catalog's own auth-context ids
// (`anthropic-api`, `gateway`, `baseline`, …) instead of the old coarse
// `surface`+`route` pair. `AgentModelSnapshotIngestRequest` and the old
// mirror/refresh product-mutation surface are deliberately NOT re-exported
// here: ingest is Worker-authenticated only (`authenticate_worker`), so no
// product client can call it — see F-040.
export type AgentModels = Schema<"AgentModelsResponse">;
export type AgentModelOverride = Schema<"AgentModelOverrideResponse">;
export type UpsertAgentModelOverrideRequest =
  Schema<"AgentModelOverrideUpsertRequest">;

export type OrgAgentPolicy = Schema<"OrgAgentPolicyResponse">;
export type UpdateOrgAgentPolicyRequest = Schema<"OrgAgentPolicyUpdateRequest">;
export type OrgAgentPolicyViolation = Schema<"OrgAgentPolicyViolation">;
export type OrgAgentPolicyViolationListResponse =
  Schema<"OrgAgentPolicyViolationListResponse">;
