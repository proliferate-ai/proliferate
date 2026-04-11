import { describe, expect, it } from "vitest";
import { buildSessionMcpServer } from "@/lib/domain/mcp/bindings";
import type { InstalledConnectorRecord } from "@/lib/domain/mcp/types";

describe("mcp bindings", () => {
  it("builds query-auth HTTP URLs from the secret field", () => {
    const connector: InstalledConnectorRecord = {
      metadata: {
        connectionId: "conn-openweather",
        catalogEntryId: "openweather",
        enabled: true,
        serverName: "openweather",
        syncState: "synced",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        lastSyncedAt: "2026-01-01T00:00:00.000Z",
      },
      broken: false,
      catalogEntry: {
        id: "openweather",
        name: "OpenWeather",
        oneLiner: "Weather",
        description: "Weather MCP",
        docsUrl: "https://example.com",
        availability: "universal",
        cloudSecretSync: true,
        transport: "http",
        authKind: "secret",
        authStyle: { kind: "query", parameterName: "appid" },
        authFieldId: "api_key",
        url: "https://example.com/mcp",
        serverNameBase: "openweather",
        iconId: "sun",
        requiredFields: [{
          id: "api_key",
          label: "API key",
          placeholder: "",
          helperText: "",
          getTokenInstructions: "",
        }],
      },
    };

    const server = buildSessionMcpServer(connector, {
      launchContext: { targetLocation: "local", workspacePath: "/workspace" },
      secretValues: { api_key: "weather-key" },
    });

    expect(server).toMatchObject({
      transport: "http",
      url: "https://example.com/mcp?appid=weather-key",
      headers: [],
    });
  });

  it("builds Supabase OAuth URLs from saved settings and bearer auth", () => {
    const connector: InstalledConnectorRecord = {
      metadata: {
        connectionId: "conn-supabase",
        catalogEntryId: "supabase",
        enabled: true,
        serverName: "supabase",
        syncState: "synced",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        lastSyncedAt: "2026-01-01T00:00:00.000Z",
        settings: {
          kind: "supabase",
          projectRef: "abc123",
          readOnly: true,
        },
      },
      broken: false,
      catalogEntry: {
        id: "supabase",
        name: "Supabase",
        oneLiner: "Database MCP",
        description: "Supabase MCP",
        docsUrl: "https://example.com",
        availability: "universal",
        cloudSecretSync: false,
        transport: "http",
        authKind: "oauth",
        url: "https://mcp.supabase.com/mcp",
        serverNameBase: "supabase",
        iconId: "globe",
        requiredFields: [],
      },
    };

    const server = buildSessionMcpServer(connector, {
      launchContext: { targetLocation: "cloud", workspacePath: null },
      secretValues: {},
      oauthAccessToken: "oauth-token",
    });

    expect(server).toMatchObject({
      transport: "http",
      url: "https://mcp.supabase.com/mcp?project_ref=abc123&read_only=true",
      headers: [{ name: "Authorization", value: "Bearer oauth-token" }],
    });
  });

  it("resolves stdio env vars from saved fields and static values", () => {
    const connector: InstalledConnectorRecord = {
      metadata: {
        connectionId: "conn-stdio",
        catalogEntryId: "playwright",
        enabled: true,
        serverName: "playwright",
        syncState: "synced",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        lastSyncedAt: "2026-01-01T00:00:00.000Z",
      },
      broken: false,
      catalogEntry: {
        id: "playwright",
        name: "Playwright",
        oneLiner: "Browser automation",
        description: "Playwright MCP",
        docsUrl: "https://example.com",
        availability: "local_only",
        cloudSecretSync: false,
        transport: "stdio",
        command: "playwright-mcp",
        args: [{ source: { kind: "workspace_path" } }],
        env: [
          { name: "LOG_LEVEL", source: { kind: "static", value: "debug" } },
          { name: "PLAYWRIGHT_TOKEN", source: { kind: "field", fieldId: "api_key" } },
        ],
        serverNameBase: "playwright",
        iconId: "terminal",
        requiredFields: [{
          id: "api_key",
          label: "API key",
          placeholder: "",
          helperText: "",
          getTokenInstructions: "",
        }],
      },
    };

    const server = buildSessionMcpServer(connector, {
      launchContext: { targetLocation: "local", workspacePath: "/repo" },
      secretValues: { api_key: "pw-secret" },
    });

    expect(server).toMatchObject({
      transport: "stdio",
      command: "playwright-mcp",
      args: ["/repo"],
      env: [
        { name: "LOG_LEVEL", value: "debug" },
        { name: "PLAYWRIGHT_TOKEN", value: "pw-secret" },
      ],
    });
  });
});
