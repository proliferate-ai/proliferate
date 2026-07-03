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
export type AgentGatewayCatalog = Schema<"AgentGatewayCatalogResponse">;
export type AgentAuthRoute = AgentGatewayCatalog["route"];
export type RefreshAgentGatewayCatalogRequest =
  Schema<"AgentGatewayCatalogRefreshRequest">;
export type AgentGatewayCatalogOverride =
  Schema<"AgentGatewayCatalogOverrideResponse">;
export type UpsertAgentGatewayCatalogOverrideRequest =
  Schema<"AgentGatewayCatalogOverrideUpsertRequest">;

export type OrgAgentPolicy = Schema<"OrgAgentPolicyResponse">;
export type UpdateOrgAgentPolicyRequest = Schema<"OrgAgentPolicyUpdateRequest">;
export type OrgAgentPolicyViolation = Schema<"OrgAgentPolicyViolation">;
export type OrgAgentPolicyViolationListResponse =
  Schema<"OrgAgentPolicyViolationListResponse">;
