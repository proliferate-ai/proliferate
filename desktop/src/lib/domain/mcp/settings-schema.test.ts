import { describe, expect, it } from "vitest";
import {
  connectorSettingsToCloud,
  normalizeConnectorSettings,
  validateConnectorSettings,
} from "@/lib/domain/mcp/settings-schema";
import type { ConnectorCatalogEntry } from "@/lib/domain/mcp/types";

const POSTHOG_ENTRY: ConnectorCatalogEntry = {
  id: "posthog",
  name: "PostHog",
  oneLiner: "Analytics",
  description: "Analytics",
  docsUrl: "https://posthog.com/docs/model-context-protocol",
  availability: "universal",
  cloudSecretSync: false,
  transport: "http",
  authKind: "secret",
  url: "https://mcp.posthog.com/mcp",
  displayUrl: "https://mcp.posthog.com/mcp",
  serverNameBase: "posthog",
  iconId: "posthog",
  secretFields: [],
  requiredFields: [],
  settingsSchema: [
    {
      id: "region",
      kind: "select",
      label: "Region",
      placeholder: "",
      helperText: "Region",
      required: true,
      defaultValue: "us",
      options: [
        { value: "us", label: "US" },
        { value: "eu", label: "EU" },
      ],
      affectsUrl: true,
    },
    {
      id: "readOnly",
      kind: "boolean",
      label: "Read-only",
      placeholder: "",
      helperText: "Read-only",
      required: false,
      defaultValue: false,
      options: [],
      affectsUrl: false,
    },
  ],
  capabilities: [],
};

describe("MCP settings schema helpers", () => {
  it("applies defaults and strips undeclared fields", () => {
    expect(normalizeConnectorSettings(POSTHOG_ENTRY, { kind: "legacy" })).toEqual({
      readOnly: false,
      region: "us",
    });
  });

  it("preserves explicit boolean false values", () => {
    expect(connectorSettingsToCloud(POSTHOG_ENTRY, {
      readOnly: false,
      region: "eu",
    })).toEqual({
      readOnly: false,
      region: "eu",
    });
  });

  it("validates select values against catalog options", () => {
    expect(validateConnectorSettings(POSTHOG_ENTRY, { region: "apac" })).toBe(
      "Choose a valid Region.",
    );
  });
});
