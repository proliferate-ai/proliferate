import { describe, expect, it, vi } from "vitest";
import type { LocalStdioCandidate } from "@/lib/domain/mcp/local-stdio-finalizer";
import {
  finalizeLocalStdioCandidates,
  type LocalStdioFinalizerDependencies,
} from "@/lib/workflows/mcp/finalize-local-stdio-candidates";

function candidate(overrides: Partial<LocalStdioCandidate> = {}): LocalStdioCandidate {
  return {
    connectionId: "conn_filesystem",
    catalogEntryId: "filesystem",
    serverName: "filesystem",
    connectorName: "Filesystem",
    setupKind: "none",
    localOauth: null,
    command: "npx",
    args: [],
    env: [],
    ...overrides,
  };
}

function googleWorkspaceCandidate(
  overrides: Partial<LocalStdioCandidate> = {},
): LocalStdioCandidate {
  return candidate({
    connectionId: "conn_gmail",
    catalogEntryId: "gmail",
    serverName: "gmail",
    connectorName: "Gmail",
    setupKind: "local_oauth",
    localOauth: {
      provider: "google_workspace",
      userGoogleEmail: "user@example.com",
      requiredScope: "https://www.googleapis.com/auth/gmail.readonly",
    },
    command: "uvx",
    ...overrides,
  });
}

function context(overrides: { workspacePath?: string | null; launchId?: string } = {}) {
  return {
    workspacePath: "/workspace",
    launchId: "launch-1",
    ...overrides,
  };
}

function dependencies(overrides: Partial<LocalStdioFinalizerDependencies> = {}) {
  const commandExists = vi.fn(async () => true);
  const resolveGoogleWorkspaceMcpRuntimeEnv = vi.fn(async () => ({
    status: "ready" as const,
    env: [],
  }));
  return {
    commandExists,
    resolveGoogleWorkspaceMcpRuntimeEnv,
    deps: {
      commandExists,
      resolveGoogleWorkspaceMcpRuntimeEnv,
      ...overrides,
    },
  };
}

describe("finalizeLocalStdioCandidates", () => {
  it("resolves static and workspace launch values for stdio candidates", async () => {
    const { deps, commandExists } = dependencies();

    const result = await finalizeLocalStdioCandidates([
      candidate({
        args: [
          { source: { kind: "static", value: "run" } },
          { source: { kind: "workspace_path" } },
        ],
        env: [{ name: "MODE", source: { kind: "static", value: "readonly" } }],
      }),
    ], context(), deps);

    expect(commandExists).toHaveBeenCalledWith("npx");
    expect(result).toEqual({
      mcpServers: [
        {
          transport: "stdio",
          connectionId: "conn_filesystem",
          catalogEntryId: "filesystem",
          serverName: "filesystem",
          command: "npx",
          args: ["run", "/workspace"],
          env: [{ name: "MODE", value: "readonly" }],
        },
      ],
      summaries: [
        {
          id: "conn_filesystem",
          serverName: "filesystem",
          displayName: "Filesystem",
          transport: "stdio",
          outcome: "applied",
        },
      ],
      warnings: [],
      runtimeReservations: [],
    });
  });

  it("skips workspace-bound candidates when the workspace path is unresolved", async () => {
    const { deps, commandExists } = dependencies();

    const result = await finalizeLocalStdioCandidates([
      candidate({ args: [{ source: { kind: "workspace_path" } }] }),
    ], context({ workspacePath: null }), deps);

    expect(commandExists).not.toHaveBeenCalled();
    expect(result.mcpServers).toEqual([]);
    expect(result.runtimeReservations).toEqual([]);
    expect(result.summaries).toEqual([
      expect.objectContaining({
        outcome: "not_applied",
        reason: "workspace_path_unresolved",
      }),
    ]);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        kind: "workspace_path_unresolved",
        catalogEntryId: "filesystem",
      }),
    ]);
  });

  it("turns missing commands into command warnings and resolver summaries", async () => {
    const commandExists = vi.fn(async () => false);
    const { deps, resolveGoogleWorkspaceMcpRuntimeEnv } = dependencies({ commandExists });

    const result = await finalizeLocalStdioCandidates([
      candidate(),
    ], context(), deps);

    expect(commandExists).toHaveBeenCalledWith("npx");
    expect(resolveGoogleWorkspaceMcpRuntimeEnv).not.toHaveBeenCalled();
    expect(result.mcpServers).toEqual([]);
    expect(result.summaries).toEqual([
      expect.objectContaining({
        outcome: "not_applied",
        reason: "resolver_error",
      }),
    ]);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        kind: "command_missing",
        catalogEntryId: "filesystem",
      }),
    ]);
  });

  it("marks local OAuth candidates as needing reconnect when credentials are not ready", async () => {
    const resolveGoogleWorkspaceMcpRuntimeEnv = vi.fn(async () => ({
      status: "not_ready" as const,
      code: "credential_missing",
    }));
    const { deps } = dependencies({ resolveGoogleWorkspaceMcpRuntimeEnv });

    const result = await finalizeLocalStdioCandidates([
      googleWorkspaceCandidate(),
    ], context(), deps);

    expect(resolveGoogleWorkspaceMcpRuntimeEnv).toHaveBeenCalledWith({
      connectionId: "conn_gmail",
      userGoogleEmail: "user@example.com",
      launchId: "launch-1",
    });
    expect(result.mcpServers).toEqual([]);
    expect(result.runtimeReservations).toEqual([]);
    expect(result.summaries).toEqual([
      expect.objectContaining({
        outcome: "not_applied",
        reason: "needs_reconnect",
      }),
    ]);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        kind: "needs_reconnect",
        catalogEntryId: "gmail",
      }),
    ]);
  });

  it("caches command availability within one finalization run", async () => {
    const commandExists = vi.fn(async () => true);
    const { deps } = dependencies({ commandExists });

    const result = await finalizeLocalStdioCandidates([
      candidate({ connectionId: "conn_a", serverName: "a", connectorName: "A" }),
      candidate({ connectionId: "conn_b", serverName: "b", connectorName: "B" }),
    ], context(), deps);

    expect(commandExists).toHaveBeenCalledTimes(1);
    expect(commandExists).toHaveBeenCalledWith("npx");
    expect(result.mcpServers).toHaveLength(2);
    expect(result.warnings).toEqual([]);
  });

  it("adds local OAuth env and runtime reservations for ready Google Workspace connectors", async () => {
    const resolveGoogleWorkspaceMcpRuntimeEnv = vi.fn(async () => ({
      status: "ready" as const,
      env: [
        { name: "USER_GOOGLE_EMAIL", value: "user@example.com" },
        { name: "WORKSPACE_MCP_CREDENTIALS_DIR", value: "/private/credentials" },
      ],
    }));
    const { deps } = dependencies({ resolveGoogleWorkspaceMcpRuntimeEnv });

    const result = await finalizeLocalStdioCandidates([
      googleWorkspaceCandidate({
        env: [{ name: "GOOGLE_OAUTH_CLIENT_ID", source: { kind: "static", value: "client-id" } }],
      }),
    ], context({ launchId: "launch-gmail" }), deps);

    expect(result.warnings).toEqual([]);
    expect(result.mcpServers).toEqual([
      expect.objectContaining({
        catalogEntryId: "gmail",
        env: [
          { name: "GOOGLE_OAUTH_CLIENT_ID", value: "client-id" },
          { name: "USER_GOOGLE_EMAIL", value: "user@example.com" },
          { name: "WORKSPACE_MCP_CREDENTIALS_DIR", value: "/private/credentials" },
        ],
      }),
    ]);
    expect(result.runtimeReservations).toEqual([
      {
        provider: "google_workspace",
        connectionId: "conn_gmail",
        launchId: "launch-gmail",
      },
    ]);
  });

  it("reports runtime reservation failures as resolver warnings", async () => {
    const resolveGoogleWorkspaceMcpRuntimeEnv = vi.fn(async () => ({
      status: "not_ready" as const,
      code: "port_unavailable",
    }));
    const { deps } = dependencies({ resolveGoogleWorkspaceMcpRuntimeEnv });

    const result = await finalizeLocalStdioCandidates([
      googleWorkspaceCandidate(),
    ], context(), deps);

    expect(result.mcpServers).toEqual([]);
    expect(result.runtimeReservations).toEqual([]);
    expect(result.summaries).toEqual([
      expect.objectContaining({
        outcome: "not_applied",
        reason: "resolver_error",
      }),
    ]);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        kind: "resolver_error",
        catalogEntryId: "gmail",
      }),
    ]);
  });
});
