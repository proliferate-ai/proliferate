import { describe, expect, it } from "vitest";
import type { SessionMcpBindingSummary, SessionMcpServer } from "@anyharness/sdk";
import { buildSessionPluginBundle } from "@/lib/domain/plugins/session-plugin-bundle";
import type { PluginPackageCatalogEntry } from "@/lib/domain/plugins/types";

function appliedSummary(overrides: Partial<SessionMcpBindingSummary> = {}): SessionMcpBindingSummary {
  return {
    id: "conn_github",
    serverName: "github",
    displayName: "GitHub",
    transport: "http",
    outcome: "applied",
    ...overrides,
  };
}

type HttpSessionMcpServer = Extract<SessionMcpServer, { transport: "http" }>;

function httpServer(overrides: Partial<HttpSessionMcpServer> = {}): HttpSessionMcpServer {
  return {
    transport: "http",
    connectionId: "conn_github",
    catalogEntryId: "github",
    serverName: "github",
    url: "https://example.com/mcp",
    headers: [],
    ...overrides,
  } satisfies HttpSessionMcpServer;
}

function pluginPackage(overrides: Partial<PluginPackageCatalogEntry> = {}): PluginPackageCatalogEntry {
  return {
    id: "github",
    catalogEntryId: "github",
    version: "1",
    displayName: "GitHub",
    description: "GitHub package",
    skills: [
      {
        id: "triage",
        displayName: "GitHub triage",
        description: "Inspect GitHub state.",
        instructions: "# GitHub triage",
        requiredMcpServerRefs: ["github"],
        requiresCredentialBinding: true,
        resources: [],
        defaultEnabled: true,
      },
    ],
    ...overrides,
  };
}

describe("buildSessionPluginBundle", () => {
  it("builds MCP-only plugin bundles without synthetic skills", () => {
    const bundle = buildSessionPluginBundle({
      mcpServers: [httpServer()],
      mcpBindingSummaries: [appliedSummary()],
      pluginPackages: [pluginPackage({ skills: [] })],
    });

    expect(bundle).toEqual({
      plugins: [
        expect.objectContaining({
          pluginId: "connector.conn_github",
          skills: [],
          mcpServers: [expect.objectContaining({ connectionId: "conn_github" })],
        }),
      ],
    });
    expect(JSON.stringify(bundle)).not.toContain("connector.conn_github.use");
  });

  it("rewrites catalog skill MCP refs to concrete server names", () => {
    const bundle = buildSessionPluginBundle({
      mcpServers: [httpServer({ serverName: "github_conn_github" })],
      mcpBindingSummaries: [appliedSummary({ serverName: "github_conn_github" })],
      pluginPackages: [pluginPackage()],
    });

    expect(bundle?.plugins?.[0]?.skills).toEqual([
      expect.objectContaining({
        skillId: "connector.conn_github.triage",
        requiredMcpServers: ["github_conn_github"],
        credentialBindingIds: ["conn_github"],
      }),
    ]);
  });

  it("skips skills when required MCP refs do not match the concrete server", () => {
    const bundle = buildSessionPluginBundle({
      mcpServers: [httpServer({ catalogEntryId: "github", serverName: "github_conn_github" })],
      mcpBindingSummaries: [appliedSummary({ serverName: "github_conn_github" })],
      pluginPackages: [
        pluginPackage({
          skills: [
            {
              ...pluginPackage().skills[0],
              requiredMcpServerRefs: ["linear"],
            },
          ],
        }),
      ],
    });

    expect(bundle?.plugins?.[0]?.skills).toEqual([]);
  });

  it("skips applied summaries without a matching concrete server", () => {
    const bundle = buildSessionPluginBundle({
      mcpServers: [httpServer({ connectionId: "different", serverName: "github" })],
      mcpBindingSummaries: [appliedSummary()],
      pluginPackages: [pluginPackage()],
    });

    expect(bundle).toBeUndefined();
  });

  it("does not match a server by name when connection id differs", () => {
    const bundle = buildSessionPluginBundle({
      mcpServers: [
        httpServer({
          connectionId: "conn_other",
          catalogEntryId: "github",
          serverName: "github",
        }),
      ],
      mcpBindingSummaries: [appliedSummary({ id: "conn_github", serverName: "github" })],
      pluginPackages: [pluginPackage()],
    });

    expect(bundle).toBeUndefined();
  });
});
