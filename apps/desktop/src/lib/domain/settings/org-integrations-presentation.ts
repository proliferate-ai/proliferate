import type { AdminIntegrationDefinition } from "@proliferate/cloud-sdk/client/integrations";

/**
 * Presentation logic for the org-admin integrations pane: definition
 * source/provenance labels and the "Add custom MCP" form validation that
 * mirrors the server's create-definition rules.
 */

/** Human label for where a definition comes from. */
export function adminIntegrationSourceLabel(source: string): string {
  return source === "org_custom" ? "Custom" : "Built-in";
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

export interface CustomIntegrationFormInput {
  displayName: string;
  namespace: string;
  mcpUrl: string;
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
