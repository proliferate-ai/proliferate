import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getDesktopCloudAccessToken,
  isCloudAgentKind,
  type CloudWorkspaceDetail,
} from "@/lib/access/cloud/client";
import {
  type CloudSandboxGatewayUrlSource,
  resolveCloudSandboxGatewayConnectionForWorkspace,
} from "@/lib/access/cloud/cloud-sandbox-gateway";

vi.mock("@/lib/access/cloud/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/access/cloud/client")>();
  return {
    getDesktopCloudAccessToken: vi.fn(),
    isCloudAgentKind: vi.fn(),
    ProliferateClientError: actual.ProliferateClientError,
  };
});

const getProductToken = vi.mocked(getDesktopCloudAccessToken);
const isKnownCloudAgent = vi.mocked(isCloudAgentKind);

// The gateway receives the Cloud client (its URL builder) as an explicit
// dependency; it never reaches for a client singleton. This stand-in proves the
// gateway URL is derived from exactly the passed client.
const explicitCloudClient: CloudSandboxGatewayUrlSource = {
  buildUrl: (path: string) => `http://api.test${path}`,
};

describe("resolveCloudSandboxGatewayConnectionForWorkspace", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getProductToken.mockResolvedValue("product-token");
    isKnownCloudAgent.mockImplementation((kind) => kind === "claude" || kind === "codex");
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
