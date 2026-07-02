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
export type AgentGatewayCatalog = Schema<"AgentGatewayCatalogResponse">;
export type RefreshAgentGatewayCatalogRequest =
  Schema<"AgentGatewayCatalogRefreshRequest">;
export type AgentGatewayCatalogOverride =
  Schema<"AgentGatewayCatalogOverrideResponse">;
export type UpsertAgentGatewayCatalogOverrideRequest =
  Schema<"AgentGatewayCatalogOverrideUpsertRequest">;
export type AgentAuthSurface = AgentAuthRouteSelection["surface"];
export type AgentAuthRoute = AgentAuthRouteSelection["route"];
