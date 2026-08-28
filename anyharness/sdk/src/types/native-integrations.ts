// Native integrations — which pieces of the user's own harness installation
// (native MCP servers, curated vendor bundles) the user has re-admitted into
// Proliferate sessions. Wire shapes owned by
// anyharness-contract::v1::native_integrations; spec:
// specs/systems/harnesses/native-integrations.md.
import type { components } from "../generated/openapi.js";

export type NativeIntegrationKind = components["schemas"]["NativeIntegrationKind"];
export type NativeIntegrationRisk = components["schemas"]["NativeIntegrationRisk"];
export type NativeIntegration = components["schemas"]["NativeIntegration"];
export type NativeIntegrationsResponse = components["schemas"]["NativeIntegrationsResponse"];
export type NativeIntegrationSelectionRequest =
  components["schemas"]["NativeIntegrationSelectionRequest"];
