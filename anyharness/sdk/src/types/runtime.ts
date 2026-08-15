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
export type RuntimeDiskPressure = components["schemas"]["RuntimeDiskPressure"];
export type RuntimeMemoryPressure = components["schemas"]["RuntimeMemoryPressure"];
export type RuntimeResourcePressure = components["schemas"]["RuntimeResourcePressure"];
export type AgentSeedHealth = components["schemas"]["AgentSeedHealth"];
export type AgentSeedStatus = components["schemas"]["AgentSeedStatus"];
export type AgentSeedSource = components["schemas"]["AgentSeedSource"];
export type AgentSeedOwnership = components["schemas"]["AgentSeedOwnership"];
export type AgentSeedLastAction = components["schemas"]["AgentSeedLastAction"];
export type AgentSeedFailureKind = components["schemas"]["AgentSeedFailureKind"];
/**
 * RFC 7807 problem details.
 *
 * `extra` is widened from the generated type. The runtime declares it as a
 * free-form object, which `openapi-typescript` narrows to
 * `Record<string, never>` — a shape that claims the payload has no keys and
 * would make the client's untouched passthrough uncompilable. The payload is
 * per-code (the unarchive scenario body, the git-lock file path), so `unknown` is
 * the honest type and the caller narrows it at the point of use.
 */
export type ProblemDetails =
  & Omit<components["schemas"]["ProblemDetails"], "extra">
  & { extra?: unknown };
