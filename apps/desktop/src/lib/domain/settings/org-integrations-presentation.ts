import type { AdminIntegrationDefinition } from "@proliferate/cloud-sdk/client/integrations";
import { integrationAuthKindLabel } from "@/lib/domain/settings/integrations-presentation";

/**
 * Presentation logic for the org-admin integrations pane: definition
 * source/provenance labels and the "Add custom MCP" form validation that
 * mirrors the server's create-definition rules.
 */

/** Human label for where a definition comes from. */
export function adminIntegrationSourceLabel(source: string): string {
  return source === "org_custom" ? "Custom" : "Built-in";
}

/**
 * Human label for how a definition authenticates. Admin definitions carry the
 * auth kind as a plain string, so unknown values pass through unchanged.
 */
export function adminIntegrationAuthKindLabel(authKind: string): string {
  switch (authKind) {
    case "oauth2":
    case "api_key":
    case "none":
      return integrationAuthKindLabel(authKind);
    default:
      return authKind;
  }
}

export interface AdminIntegrationEnabledView {
  enabled: boolean;
  /**
   * Where the effective-enabled value comes from: an explicit org policy or
   * the definition's default. Shown subtly next to the switch.
   */
  provenance: string;
}

export function adminIntegrationEnabledView(
  definition: Pick<
    AdminIntegrationDefinition,
    "effectiveEnabled" | "policyEnabled" | "enabledByDefault"
  >,
): AdminIntegrationEnabledView {
  return {
    enabled: definition.effectiveEnabled,
    provenance: definition.policyEnabled !== null
      ? "Set by org policy"
      : definition.enabledByDefault
        ? "Default: on"
        : "Default: off",
  };
}

/** Admin's authentication choice when adding a custom MCP definition. */
export type CustomIntegrationAuthChoice = "auto" | "none" | "oauth2";

export const CUSTOM_INTEGRATION_AUTH_OPTIONS: ReadonlyArray<{
  value: CustomIntegrationAuthChoice;
  label: string;
}> = [
  { value: "auto", label: "Auto-detect" },
  { value: "none", label: "None" },
  { value: "oauth2", label: "OAuth" },
];

export interface CustomIntegrationFormInput {
  displayName: string;
  namespace: string;
  mcpUrl: string;
  authKind: CustomIntegrationAuthChoice;
}

export interface CustomIntegrationFormErrors {
  displayName?: string;
  namespace?: string;
  mcpUrl?: string;
}

/** Mirrors the server's namespace rule for org-custom definitions. */
const NAMESPACE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * Client-side mirror of the server validation for POST definitions, so the
 * common mistakes surface inline before a round trip. `null` means valid.
 */
export function validateCustomIntegrationForm(
  input: CustomIntegrationFormInput,
): CustomIntegrationFormErrors | null {
  const errors: CustomIntegrationFormErrors = {};
  if (!input.displayName.trim()) {
    errors.displayName = "Display name is required.";
  }
  if (!NAMESPACE_PATTERN.test(input.namespace.trim())) {
    errors.namespace =
      "Use 1-64 lowercase letters, digits, '_' or '-', starting with a letter or digit.";
  }
  if (!isValidMcpUrl(input.mcpUrl.trim())) {
    errors.mcpUrl = "Enter a valid http(s) URL.";
  }
  return Object.keys(errors).length > 0 ? errors : null;
}

function isValidMcpUrl(value: string): boolean {
  if (!value) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.host !== "";
}

/**
 * Inline message for a failed create-definition call. API validation errors
 * (invalid_payload et al.) carry a human-readable message; anything else
 * falls back to a generic failure line.
 */
export function customIntegrationSubmitError(apiMessage: string | null): string {
  if (apiMessage) {
    return apiMessage;
  }
  return "The custom integration could not be added. Try again.";
}

/**
 * Toast message after a successful create, stating the auth outcome: OAuth
 * (detected or forced) tells admins where members connect; an unreachable
 * probe admits the auth requirement was not verified; otherwise the
 * integration is open and the plain confirmation suffices.
 */
export function customIntegrationCreatedMessage(
  definition: Pick<AdminIntegrationDefinition, "displayName" | "authKind" | "authDetection">,
): string {
  if (definition.authKind === "oauth2") {
    return `${definition.displayName} added. OAuth required — members connect from Settings → Integrations.`;
  }
  if (definition.authDetection === "unreachable") {
    return `${definition.displayName} added, but the server could not be reached to verify authentication. It is saved without auth.`;
  }
  return `${definition.displayName} added. No authentication required.`;
}
