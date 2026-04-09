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
export type ProblemDetails = components["schemas"]["ProblemDetails"];
