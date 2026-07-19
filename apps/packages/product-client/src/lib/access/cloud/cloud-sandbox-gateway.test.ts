import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CloudWorkspaceDetail } from "@proliferate/cloud-sdk/types";
import {
  type CloudSandboxGatewayUrlSource,
  resolveCloudSandboxGatewayConnectionForWorkspace,
  resolveCloudSandboxGatewayRuntimeConnection,
} from "#product/lib/access/cloud/cloud-sandbox-gateway";
import { setSandboxGatewayAccessTokenProvider } from "#product/lib/access/cloud/sandbox-gateway-access";

// The gateway receives the Cloud client (its URL builder) as an explicit
// dependency; it never reaches for a client singleton. This stand-in proves the
// gateway URL is derived from exactly the passed client.
const explicitCloudClient: CloudSandboxGatewayUrlSource = {
  buildUrl: (path: string) => `http://api.test${path}`,
};

describe("resolveCloudSandboxGatewayConnectionForWorkspace", () => {
  beforeEach(() => {
    // The host arms this provider at mount (ruling G4); the test arms its own so
    // the gateway resolves a deterministic token without a real session.
    setSandboxGatewayAccessTokenProvider(async () => "product-token");
  });

  afterEach(() => {
    setSandboxGatewayAccessTokenProvider(null);
  });

  it("uses the gateway URL and CloudWorkspace AnyHarness workspace id", async () => {
    const connection = await resolveCloudSandboxGatewayConnectionForWorkspace({
      id: "cloud-workspace-1",
      anyharnessWorkspaceId: "runtime-workspace",
      repo: {
        owner: "proliferate-ai",
        name: "proliferate",
      },
      allowedAgentKinds: ["claude", "unknown"],
      readyAgentKinds: ["claude"],
      primaryMaterialization: {
        anyharnessWorkspaceId: "selected-workspace",
      },
      runtime: {
        generation: 7,
      },
    } as unknown as CloudWorkspaceDetail, explicitCloudClient);

    expect(connection).toMatchObject({
      runtimeUrl: "http://api.test/v1/gateway/cloud-sandbox/anyharness",
      accessToken: "product-token",
      anyharnessWorkspaceId: "runtime-workspace",
      runtimeGeneration: 7,
      runtimeAccessKind: "proliferate-gateway",
      anyharnessRepoRootId: null,
      allowedAgentKinds: ["claude"],
      readyAgentKinds: ["claude"],
    });
  });

  it("rejects when no Cloud client is available", async () => {
    await expect(
      resolveCloudSandboxGatewayConnectionForWorkspace(
        {
          id: "cloud-workspace-1",
          anyharnessWorkspaceId: "runtime-workspace",
          allowedAgentKinds: ["claude"],
          readyAgentKinds: ["claude"],
          runtime: { generation: 1 },
        } as unknown as CloudWorkspaceDetail,
        null,
      ),
    ).rejects.toThrow(/Cloud client is unavailable/);
  });
});

describe("resolveCloudSandboxGatewayRuntimeConnection", () => {
  it("targets the shared Cloud runtime without requiring a workspace id", async () => {
    const connection = await resolveCloudSandboxGatewayRuntimeConnection(
      explicitCloudClient,
      async () => "fresh-cloud-token",
    );

    expect(connection).toEqual({
      runtimeUrl: "http://api.test/v1/gateway/cloud-sandbox/anyharness",
      authToken: "fresh-cloud-token",
    });
    expect(connection).not.toHaveProperty("anyharnessWorkspaceId");
  });
});
