import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  materializeCloudMcpServersMock: vi.fn(),
  putRuntimeConfigMock: vi.fn(),
  prefetchRuntimeConfigMock: vi.fn(),
  listRuntimeConfigResolutionRequestsMock: vi.fn(),
  fulfillRuntimeConfigResolutionRequestMock: vi.fn(),
}));

vi.mock("@proliferate/cloud-sdk/client/mcp_materialization", () => ({
  materializeCloudMcpServers: mocks.materializeCloudMcpServersMock,
}));

vi.mock("@/lib/access/anyharness/runtime-config", () => ({
  putRuntimeConfig: mocks.putRuntimeConfigMock,
  prefetchRuntimeConfig: mocks.prefetchRuntimeConfigMock,
  listRuntimeConfigResolutionRequests: mocks.listRuntimeConfigResolutionRequestsMock,
  fulfillRuntimeConfigResolutionRequest: mocks.fulfillRuntimeConfigResolutionRequestMock,
}));

import { refreshRuntimeConfigForLaunch } from "@/lib/workflows/mcp/runtime-config-refresh";

describe("refreshRuntimeConfigForLaunch", () => {
  beforeEach(() => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "00000000-0000-4000-8000-000000000001",
    );
    mocks.materializeCloudMcpServersMock.mockReset();
    mocks.putRuntimeConfigMock.mockReset();
    mocks.putRuntimeConfigMock.mockResolvedValue({
      currentRevisionId: "00000000-0000-4000-8000-000000000001",
    });
    mocks.prefetchRuntimeConfigMock.mockReset();
    mocks.prefetchRuntimeConfigMock.mockResolvedValue({
      revisionId: "00000000-0000-4000-8000-000000000001",
      contentHash: "runtime-hash",
      requestIds: [],
    });
    mocks.listRuntimeConfigResolutionRequestsMock.mockReset();
    mocks.listRuntimeConfigResolutionRequestsMock.mockResolvedValue([]);
    mocks.fulfillRuntimeConfigResolutionRequestMock.mockReset();
    mocks.fulfillRuntimeConfigResolutionRequestMock.mockResolvedValue({ status: "fulfilled" });
  });

  it("stores a redacted manifest with credential refs and workspacePath templates", async () => {
    const connection = {
      runtimeUrl: "http://runtime.local",
      anyharnessWorkspaceId: "runtime-workspace-1",
    };
    mocks.materializeCloudMcpServersMock.mockResolvedValue({
      catalogVersion: "test",
      mcpServers: [
        {
          transport: "http",
          connectionId: "conn_context7",
          catalogEntryId: "context7",
          serverName: "context7",
          url: "https://mcp.example.com/mcp?api_key=query-secret&mode=read",
          headers: [{ name: "Authorization", value: "Bearer header-secret" }],
        },
      ],
      mcpBindingSummaries: [
        {
          id: "conn_context7",
          serverName: "context7",
          transport: "http",
          outcome: "applied",
          displayName: "Context7",
        },
        {
          id: "conn_bad",
          serverName: "bad",
          transport: "stdio",
          outcome: "not_applied",
          reason: "invalid_settings",
        },
      ],
      localStdioCandidates: [
        {
          connectionId: "conn_filesystem",
          catalogEntryId: "filesystem",
          serverName: "filesystem",
          command: "npx",
          args: [{ source: { kind: "workspace_path" } }],
          env: [{ name: "MODE", source: { kind: "static", value: "readonly" } }],
        },
      ],
      pluginPackages: [
        {
          id: "linear-package",
          catalogEntryId: "context7",
          version: "1",
          displayName: "Linear",
          description: "Linear package",
          skills: [
            {
              id: "linear",
              displayName: "Linear",
              description: "Use Linear issues.",
              instructions: "# Linear\nUse Linear issue workflows.",
              requiredMcpServerRefs: ["context7"],
              requiresCredentialBinding: false,
              resources: [
                {
                  resourceId: "guide",
                  displayName: "Guide",
                  contentType: "text/markdown",
                  content: "guide body",
                },
              ],
              defaultEnabled: true,
              provenance: {
                sourceRepoUrl: "https://example.com/repo",
                sourcePath: "skills/linear/SKILL.md",
                sourceRef: "main",
                sourceSha256: "source",
                adaptedSha256: "adapted",
                sourceLicense: "MIT",
                importMode: "adapted",
                reviewStatus: "reviewed",
                reviewer: "test",
                reviewedAt: "2026-05-17T00:00:00Z",
                notes: "",
              },
            },
          ],
        },
      ],
      warnings: [
        {
          connectionId: "conn_bad",
          catalogEntryId: "bad",
          connectorName: "Bad",
          kind: "invalid_settings",
        },
      ],
    });
    mocks.listRuntimeConfigResolutionRequestsMock.mockResolvedValue([
      {
        requestId: "req_1",
        kind: "missing_credential",
        credentialRefs: [
          { ref: "conn_context7:header:authorization:0" },
          { ref: "conn_context7:query:api_key:0" },
        ],
      },
    ]);

    const result = await refreshRuntimeConfigForLaunch({
      connection,
      targetLocation: "local",
      workspacePath: "/repo",
    });

    expect(mocks.materializeCloudMcpServersMock).toHaveBeenCalledWith({
      targetLocation: "local",
    });
    expect(mocks.putRuntimeConfigMock).toHaveBeenCalledTimes(1);
    const manifest = mocks.putRuntimeConfigMock.mock.calls[0]![1];
    expect(manifest.source).toBe("desktop");
    expect(manifest.revision.id).toBe("00000000-0000-4000-8000-000000000001");
    expect(manifest.mcpServers).toEqual([
      expect.objectContaining({
        id: "conn_context7:context7",
        launch: expect.objectContaining({
          transport: "http",
          baseUrl: "https://mcp.example.com/mcp",
          headers: [
            {
              name: "Authorization",
              value: {
                parts: [
                  { kind: "literal", value: "Bearer " },
                  { kind: "credential", ref: "conn_context7:header:authorization:0" },
                ],
              },
            },
          ],
          query: [
            {
              name: "api_key",
              value: {
                parts: [{ kind: "credential", ref: "conn_context7:query:api_key:0" }],
              },
            },
            {
              name: "mode",
              value: { parts: [{ kind: "literal", value: "read" }] },
            },
          ],
        }),
      }),
      expect.objectContaining({
        id: "conn_filesystem:filesystem",
        launch: expect.objectContaining({
          transport: "stdio",
          args: [{ parts: [{ kind: "workspacePath" }] }],
          env: [{ name: "MODE", value: { parts: [{ kind: "literal", value: "readonly" }] } }],
        }),
      }),
    ]);
    expect(manifest.skills).toEqual([
      expect.objectContaining({
        id: "connector.conn_context7.linear",
        packageId: "linear-package",
        displayName: "Linear",
        requiredMcpServerIds: ["context7"],
        instructionArtifact: expect.objectContaining({
          contentType: "text/markdown",
          kind: "skill_instruction",
          sourceRef: "linear-package:linear:instructions",
        }),
        resources: [
          expect.objectContaining({
            resourceId: "guide",
            artifact: expect.objectContaining({
              contentType: "text/markdown",
              kind: "skill_resource",
            }),
          }),
        ],
      }),
    ]);
    expect(manifest.skills[0].instructionArtifact.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(manifest)).not.toContain("# Linear");
    expect(JSON.stringify(manifest)).not.toContain("guide body");
    expect(JSON.stringify(manifest)).not.toContain("header-secret");
    expect(JSON.stringify(manifest)).not.toContain("query-secret");
    expect(JSON.stringify(manifest)).not.toContain("/repo");
    expect(manifest.mcpBindingSummaries[1]).toEqual(expect.objectContaining({
      outcome: "not_applied",
      reason: "resolver_error",
    }));
    expect(mocks.prefetchRuntimeConfigMock).toHaveBeenCalledWith(
      connection,
      { includeCredentials: true },
    );
    expect(mocks.fulfillRuntimeConfigResolutionRequestMock).toHaveBeenCalledWith(
      connection,
      "req_1",
      {
        artifacts: [],
        credentials: expect.arrayContaining([
          expect.objectContaining({
            ref: "conn_context7:header:authorization:0",
            value: "header-secret",
          }),
          expect.objectContaining({
            ref: "conn_context7:query:api_key:0",
            value: "query-secret",
          }),
        ]),
      },
    );
    expect(result.warnings).toEqual([
      expect.objectContaining({ kind: "invalid_settings", catalogEntryId: "bad" }),
    ]);
  });
});
