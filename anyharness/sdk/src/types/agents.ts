import type { components } from "../generated/openapi.js";

export type AgentInstallState = components["schemas"]["AgentInstallState"];
export type AgentCredentialState = components["schemas"]["AgentCredentialState"];
export type AgentReadinessState = components["schemas"]["AgentReadinessState"];
export type ArtifactStatus = components["schemas"]["ArtifactStatus"];
export type AgentSummary = components["schemas"]["AgentSummary"];
export type AgentAuthExternalScope = components["schemas"]["AgentAuthExternalScope"];
export type AgentAuthSelectionConfig = components["schemas"]["AgentAuthSelectionConfig"];
export type ApplyAgentAuthConfigRequest = components["schemas"]["ApplyAgentAuthConfigRequest"];
export type ApplyAgentAuthConfigResponse = components["schemas"]["ApplyAgentAuthConfigResponse"];
export type AgentAuthSelectionStatus = components["schemas"]["AgentAuthSelectionStatus"];
export type AgentAuthConfigStatusResponse =
  components["schemas"]["AgentAuthConfigStatusResponse"];
export type AgentLaunchOptionsResponse = components["schemas"]["AgentLaunchOptionsResponse"];
export type InstallAgentRequest = components["schemas"]["InstallAgentRequest"];
export type InstallAgentResponse = components["schemas"]["InstallAgentResponse"];
export type LoginCommand = components["schemas"]["LoginCommand"];
export type StartAgentLoginResponse = components["schemas"]["StartAgentLoginResponse"];
export type AgentLoginTerminalStatus = components["schemas"]["AgentLoginTerminalStatus"];
export type AgentLoginTerminalRecord = components["schemas"]["AgentLoginTerminalRecord"];
export type StartAgentLoginTerminalResponse =
  components["schemas"]["StartAgentLoginTerminalResponse"];
export type ReconcileOutcome = components["schemas"]["ReconcileOutcome"];
export type ReconcileJobStatus = components["schemas"]["ReconcileJobStatus"];
export type ReconcileAgentsRequest = components["schemas"]["ReconcileAgentsRequest"];
export type ReconcileAgentResult = components["schemas"]["ReconcileAgentResult"];
export type ReconcileAgentsResponse = components["schemas"]["ReconcileAgentsResponse"];
