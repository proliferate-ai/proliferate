import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveRuntimeTargetForWorkspace: vi.fn(),
}));

vi.mock("#product/lib/access/anyharness/runtime-target", () => ({
  resolveRuntimeTargetForWorkspace: mocks.resolveRuntimeTargetForWorkspace,
}));

import { resolveWorkspaceConnection } from "#product/lib/access/anyharness/resolve-workspace-connection";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveWorkspaceConnection", () => {
  it.each([
    {
      location: "local" as const,
      expectedOrigin: "desktop-local" as const,
      runtimeAccessKind: "direct" as const,
      webSocketAuthTransport: undefined,
    },
    {
      location: "cloud" as const,
      expectedOrigin: "remote" as const,
      runtimeAccessKind: "proliferate-gateway" as const,
      webSocketAuthTransport: "protocol" as const,
    },
    {
      location: "target" as const,
      expectedOrigin: "remote" as const,
      runtimeAccessKind: undefined,
      webSocketAuthTransport: undefined,
    },
  ])("maps $location provenance without narrowing connection metadata", async ({
    location,
    expectedOrigin,
    runtimeAccessKind,
    webSocketAuthTransport,
  }) => {
    mocks.resolveRuntimeTargetForWorkspace.mockResolvedValue({
      location,
      baseUrl: `https://${location}.runtime.test`,
      authToken: `${location}-token`,
      anyharnessWorkspaceId: `${location}-workspace`,
      runtimeGeneration: 7,
      runtimeAccessKind,
      webSocketAuthTransport,
    });

    await expect(resolveWorkspaceConnection(
      "http://local.runtime.test",
      `${location}-selected`,
      null,
      null,
    )).resolves.toEqual({
      connection: {
        runtimeUrl: `https://${location}.runtime.test`,
        authToken: `${location}-token`,
        anyharnessWorkspaceId: `${location}-workspace`,
        runtimeGeneration: 7,
        runtimeAccessKind,
        webSocketAuthTransport,
      },
      filesystemOrigin: expectedOrigin,
    });
  });
});
