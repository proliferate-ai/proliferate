/**
 * Public contract types for the AnyHarness runtime API.
 *
 * These are thin aliases over the generated OpenAPI schema types so the
 * public SDK surface stays stable even if the generated module shape changes.
 * The Rust `anyharness-contract` crate is the source of truth; run
 * `pnpm generate` to regenerate.
 */

import type { components } from "../generated/openapi.js";

export type HealthResponse = components["schemas"]["HealthResponse"];
export type RuntimeCapabilities = components["schemas"]["RuntimeCapabilities"];
export type AgentSeedHealth = components["schemas"]["AgentSeedHealth"];
export type AgentSeedStatus = components["schemas"]["AgentSeedStatus"];
export type AgentSeedSource = components["schemas"]["AgentSeedSource"];
export type AgentSeedOwnership = components["schemas"]["AgentSeedOwnership"];
export type AgentSeedLastAction = components["schemas"]["AgentSeedLastAction"];
export type AgentSeedFailureKind = components["schemas"]["AgentSeedFailureKind"];
export type ProblemDetails = components["schemas"]["ProblemDetails"];
export type RuntimeConfigResolutionProblem =
  components["schemas"]["RuntimeConfigResolutionProblem"];
export type RuntimeConfigResolutionReason =
  components["schemas"]["RuntimeConfigResolutionReason"];
export type RuntimeConfigOwnerScope = components["schemas"]["RuntimeConfigOwnerScope"];
export type RuntimeConfigSource = components["schemas"]["RuntimeConfigSource"];
export type RuntimeCredentialKind = components["schemas"]["RuntimeCredentialKind"];
export type RuntimeCredentialRef = components["schemas"]["RuntimeCredentialRef"];
export type RuntimeArtifactKind = components["schemas"]["RuntimeArtifactKind"];
export type RuntimeArtifactRef = components["schemas"]["RuntimeArtifactRef"];
export type RuntimeMcpServer = components["schemas"]["RuntimeMcpServer"];
export type RuntimeMcpLaunch = components["schemas"]["RuntimeMcpLaunch"];
export type RuntimeMcpHttpLaunch = components["schemas"]["RuntimeMcpHttpLaunch"];
export type RuntimeMcpStdioLaunch = components["schemas"]["RuntimeMcpStdioLaunch"];
export type RuntimeMcpHeader = components["schemas"]["RuntimeMcpHeader"];
export type RuntimeMcpQueryParam = components["schemas"]["RuntimeMcpQueryParam"];
export type RuntimeMcpEnvVar = components["schemas"]["RuntimeMcpEnvVar"];
export type RuntimeTextTemplate = components["schemas"]["RuntimeTextTemplate"];
export type RuntimeTextTemplatePart = components["schemas"]["RuntimeTextTemplatePart"];
export type RuntimeSkill = components["schemas"]["RuntimeSkill"];
export type RuntimeSkillResource = components["schemas"]["RuntimeSkillResource"];
export type TargetRuntimeConfigRevision =
  components["schemas"]["TargetRuntimeConfigRevision"];
export type TargetRuntimeConfigRefreshRequest =
  components["schemas"]["TargetRuntimeConfigRefreshRequest"];
export type TargetRuntimeConfigResponse =
  components["schemas"]["TargetRuntimeConfigResponse"];
export type TargetRuntimeConfigApplyResponse =
  components["schemas"]["TargetRuntimeConfigApplyResponse"];
export type RuntimeConfigPrefetchRequest =
  components["schemas"]["RuntimeConfigPrefetchRequest"];
export type RuntimeConfigPrefetchResponse =
  components["schemas"]["RuntimeConfigPrefetchResponse"];
export type RuntimeResolutionRequest =
  components["schemas"]["RuntimeResolutionRequest"];
export type RuntimeResolutionRequestKind =
  components["schemas"]["RuntimeResolutionRequestKind"];
export type RuntimeArtifactCacheEntry =
  components["schemas"]["RuntimeArtifactCacheEntry"];
export type RuntimeResolutionFulfillRequest =
  components["schemas"]["RuntimeResolutionFulfillRequest"];
export type RuntimeArtifactFulfillment =
  components["schemas"]["RuntimeArtifactFulfillment"];
export type RuntimeCredentialFulfillment =
  components["schemas"]["RuntimeCredentialFulfillment"];
export type RuntimeResolutionRejectRequest =
  components["schemas"]["RuntimeResolutionRejectRequest"];
