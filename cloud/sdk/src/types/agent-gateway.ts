import type { Schema } from "./schema.js";

export type AgentApiKey = Schema<"AgentApiKeyResponse">;
export type AgentApiKeyListResponse = Schema<"AgentApiKeyListResponse">;
export type CreateAgentApiKeyRequest = Schema<"AgentApiKeyCreateRequest">;
export type AgentAuthRouteSelection = Schema<"AgentAuthRouteSelectionResponse">;
export type AgentAuthRouteSelectionListResponse =
  Schema<"AgentAuthRouteSelectionListResponse">;
export type UpsertAgentAuthRouteSelectionRequest =
  Schema<"AgentAuthRouteSelectionUpsertRequest">;
export type AgentGatewayCapabilities = Schema<"AgentGatewayCapabilitiesResponse">;
export type AgentGatewayEnrollment = Schema<"AgentGatewayEnrollmentResponse">;
export type AgentAuthSurface = AgentAuthRouteSelection["surface"];
export type AgentAuthRoute = AgentAuthRouteSelection["route"];
export type OrgAgentPolicy = Schema<"OrgAgentPolicyResponse">;
export type UpdateOrgAgentPolicyRequest = Schema<"OrgAgentPolicyUpdateRequest">;
export type OrgAgentPolicyViolation = Schema<"OrgAgentPolicyViolation">;
export type OrgAgentPolicyViolationListResponse =
  Schema<"OrgAgentPolicyViolationListResponse">;
