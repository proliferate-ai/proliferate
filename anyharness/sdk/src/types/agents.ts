import type { components } from "../generated/openapi.js";

export type AgentInstallState = components["schemas"]["AgentInstallState"];
export type AgentCredentialState = components["schemas"]["AgentCredentialState"];
export type AgentReadinessState = components["schemas"]["AgentReadinessState"];
export type ArtifactStatus = components["schemas"]["ArtifactStatus"];
export type AgentSummary = components["schemas"]["AgentSummary"];
export type ModelRegistrySource = components["schemas"]["ModelRegistrySource"];
export type ModelRegistryStatus = components["schemas"]["ModelRegistryStatus"];
export type ModelCatalogStatus = components["schemas"]["ModelCatalogStatus"];
export type AgentModelRegistryModel = components["schemas"]["AgentModelRegistryModel"];
export type AgentModelRegistrySnapshotResponse =
  components["schemas"]["AgentModelRegistrySnapshotResponse"];
export type RefreshAgentModelRegistryRequest =
  components["schemas"]["RefreshAgentModelRegistryRequest"];
export type RefreshAgentModelRegistryResponse =
  components["schemas"]["RefreshAgentModelRegistryResponse"];
export type AgentLaunchOptionsResponse = components["schemas"]["AgentLaunchOptionsResponse"];
export type InstallAgentRequest = components["schemas"]["InstallAgentRequest"];
export type InstallAgentResponse = components["schemas"]["InstallAgentResponse"];
export type LoginCommand = components["schemas"]["LoginCommand"];
export type StartAgentLoginResponse = components["schemas"]["StartAgentLoginResponse"];
export type ReconcileOutcome = components["schemas"]["ReconcileOutcome"];
export type ReconcileJobStatus = components["schemas"]["ReconcileJobStatus"];
export type ReconcileAgentsRequest = components["schemas"]["ReconcileAgentsRequest"];
export type ReconcileAgentResult = components["schemas"]["ReconcileAgentResult"];
export type ReconcileAgentsResponse = components["schemas"]["ReconcileAgentsResponse"];
