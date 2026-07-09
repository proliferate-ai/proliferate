import { describe, expect, it } from "vitest";
import {
  adminIntegrationAuthKindLabel,
  adminIntegrationEnabledView,
  adminIntegrationSourceLabel,
  customIntegrationCreatedMessage,
  customIntegrationSubmitError,
  validateCustomIntegrationForm,
} from "@/lib/domain/settings/org-integrations-presentation";

describe("adminIntegrationSourceLabel", () => {
  it("marks seed definitions as built-in and org customs as custom", () => {
    expect(adminIntegrationSourceLabel("seed")).toBe("Built-in");
    expect(adminIntegrationSourceLabel("org_custom")).toBe("Custom");
  });
});

describe("adminIntegrationAuthKindLabel", () => {
  it("labels the known auth kinds like the user pane", () => {
    expect(adminIntegrationAuthKindLabel("oauth2")).toBe("OAuth");
    expect(adminIntegrationAuthKindLabel("api_key")).toBe("API key");
    expect(adminIntegrationAuthKindLabel("none")).toBe("No auth");
  });

  it("passes unknown kinds through unchanged", () => {
    expect(adminIntegrationAuthKindLabel("mystery")).toBe("mystery");
  });
});

describe("customIntegrationCreatedMessage", () => {
  it("tells admins where members connect when OAuth was detected or forced", () => {
    for (const authDetection of ["detected", "forced"] as const) {
      expect(customIntegrationCreatedMessage({
        displayName: "Internal tools",
        authKind: "oauth2",
        authDetection,
      })).toBe(
        "Internal tools added. OAuth required — members connect from Settings → Integrations.",
      );
    }
  });

  it("admits when the probe could not reach the server", () => {
    expect(customIntegrationCreatedMessage({
      displayName: "Internal tools",
      authKind: "none",
      authDetection: "unreachable",
    })).toBe(
      "Internal tools added, but the server could not be reached to verify "
      + "authentication. It is saved without auth.",
    );
  });

  it("confirms open servers plainly", () => {
    expect(customIntegrationCreatedMessage({
      displayName: "Internal tools",
      authKind: "none",
      authDetection: "none",
    })).toBe("Internal tools added. No authentication required.");
    expect(customIntegrationCreatedMessage({
      displayName: "Internal tools",
      authKind: "none",
      authDetection: "forced",
    })).toBe("Internal tools added. No authentication required.");
  });
});

describe("adminIntegrationEnabledView", () => {
  it("attributes an explicit policy to the org", () => {
    expect(adminIntegrationEnabledView({
      effectiveEnabled: false,
      policyEnabled: false,
      enabledByDefault: true,
    })).toEqual({ enabled: false, provenance: "Set by org policy" });
  });

  it("falls back to the definition default when no policy exists", () => {
    expect(adminIntegrationEnabledView({
      effectiveEnabled: true,
      policyEnabled: null,
      enabledByDefault: true,
    })).toEqual({ enabled: true, provenance: "Default: on" });
    expect(adminIntegrationEnabledView({
      effectiveEnabled: false,
      policyEnabled: null,
      enabledByDefault: false,
    })).toEqual({ enabled: false, provenance: "Default: off" });
  });
});

describe("validateCustomIntegrationForm", () => {
  const valid = {
    displayName: "Internal tools",
    namespace: "internal-tools",
    mcpUrl: "https://mcp.example.com/mcp",
    authKind: "auto" as const,
  };

  it("accepts a valid form", () => {
    expect(validateCustomIntegrationForm(valid)).toBeNull();
  });

  it("requires a display name", () => {
    expect(validateCustomIntegrationForm({ ...valid, displayName: "  " })).toEqual({
      displayName: "Display name is required.",
    });
  });

  it("rejects namespaces that break the server pattern", () => {
    for (const namespace of ["", "-leading-dash", "Upper", "has space", "a".repeat(65)]) {
      expect(validateCustomIntegrationForm({ ...valid, namespace })).toEqual({
        namespace:
          "Use 1-64 lowercase letters, digits, '_' or '-', starting with a letter or digit.",
      });
    }
  });

  it("accepts namespaces at the pattern boundaries", () => {
    expect(validateCustomIntegrationForm({ ...valid, namespace: "a" })).toBeNull();
    expect(validateCustomIntegrationForm({ ...valid, namespace: "0tools_x-y" })).toBeNull();
    expect(validateCustomIntegrationForm({ ...valid, namespace: "a".repeat(64) })).toBeNull();
  });

  it("rejects non-http(s) or malformed MCP URLs", () => {
    for (const mcpUrl of ["", "not a url", "ftp://mcp.example.com", "https://"]) {
      expect(validateCustomIntegrationForm({ ...valid, mcpUrl })).toEqual({
        mcpUrl: "Enter a valid http(s) URL.",
      });
    }
    expect(validateCustomIntegrationForm({ ...valid, mcpUrl: "http://localhost:8080/mcp" }))
      .toBeNull();
  });

  it("reports every invalid field at once", () => {
    expect(validateCustomIntegrationForm({
      displayName: "",
      namespace: "!",
      mcpUrl: "nope",
      authKind: "auto",
    }))
      .toEqual({
        displayName: "Display name is required.",
        namespace:
          "Use 1-64 lowercase letters, digits, '_' or '-', starting with a letter or digit.",
        mcpUrl: "Enter a valid http(s) URL.",
      });
  });
});

describe("customIntegrationSubmitError", () => {
  it("surfaces the API validation message inline", () => {
    const message =
      "Namespace must be 1-64 lowercase alphanumeric, '_' or '-' characters and "
      + "start with a letter or digit.";
    expect(customIntegrationSubmitError(message)).toBe(message);
  });

  it("falls back to a generic message for unknown failures", () => {
    expect(customIntegrationSubmitError(null)).toBe(
      "The custom integration could not be added. Try again.",
    );
    expect(customIntegrationSubmitError("")).toBe(
      "The custom integration could not be added. Try again.",
    );
  });
});
