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
export type RuntimePressureLevel = components["schemas"]["RuntimePressureLevel"];
export type RuntimeCpuPressure = components["schemas"]["RuntimeCpuPressure"];
export type RuntimeMemoryPressure = components["schemas"]["RuntimeMemoryPressure"];
export type RuntimeResourcePressure = components["schemas"]["RuntimeResourcePressure"];
export type AgentSeedHealth = components["schemas"]["AgentSeedHealth"];
export type AgentSeedStatus = components["schemas"]["AgentSeedStatus"];
export type AgentSeedSource = components["schemas"]["AgentSeedSource"];
export type AgentSeedOwnership = components["schemas"]["AgentSeedOwnership"];
export type AgentSeedLastAction = components["schemas"]["AgentSeedLastAction"];
export type AgentSeedFailureKind = components["schemas"]["AgentSeedFailureKind"];
export type ProblemDetails = components["schemas"]["ProblemDetails"];
