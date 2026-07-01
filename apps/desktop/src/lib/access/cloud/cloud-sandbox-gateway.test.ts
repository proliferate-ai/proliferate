import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getDesktopCloudAccessToken,
  getProliferateClient,
  isCloudAgentKind,
  type CloudWorkspaceDetail,
} from "@/lib/access/cloud/client";
import {
  resolveCloudSandboxGatewayConnectionForWorkspace,
} from "@/lib/access/cloud/cloud-sandbox-gateway";

vi.mock("@/lib/access/cloud/client", () => ({
  getDesktopCloudAccessToken: vi.fn(),
  getProliferateClient: vi.fn(),
  isCloudAgentKind: vi.fn(),
}));

const getProductToken = vi.mocked(getDesktopCloudAccessToken);
const getClient = vi.mocked(getProliferateClient);
const isKnownCloudAgent = vi.mocked(isCloudAgentKind);

describe("resolveCloudSandboxGatewayConnectionForWorkspace", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getProductToken.mockResolvedValue("product-token");
    getClient.mockReturnValue({
      buildUrl: (path: string) => `http://api.test${path}`,
    } as ReturnType<typeof getProliferateClient>);
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
        runtimeAuth: {
          status: "current",
          configCurrent: true,
          targetCurrent: true,
          requiresRestart: false,
        },
      },
    } as unknown as CloudWorkspaceDetail);

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
});
