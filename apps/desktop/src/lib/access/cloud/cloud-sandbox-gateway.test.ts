import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureCloudSandboxWorkspaceRuntimeConnection,
} from "@proliferate/cloud-sdk/client/cloud-sandboxes";
import {
  getDesktopCloudAccessToken,
  isCloudAgentKind,
  type CloudWorkspaceDetail,
} from "@/lib/access/cloud/client";
import {
  resolveCloudSandboxGatewayConnectionForWorkspace,
} from "@/lib/access/cloud/cloud-sandbox-gateway";

vi.mock("@proliferate/cloud-sdk/client/cloud-sandboxes", () => ({
  ensureCloudSandboxWorkspaceRuntimeConnection: vi.fn(),
}));

vi.mock("@/lib/access/cloud/client", () => ({
  getDesktopCloudAccessToken: vi.fn(),
  isCloudAgentKind: vi.fn(),
}));

const ensureRuntimeConnection = vi.mocked(ensureCloudSandboxWorkspaceRuntimeConnection);
const getProductToken = vi.mocked(getDesktopCloudAccessToken);
const isKnownCloudAgent = vi.mocked(isCloudAgentKind);

describe("resolveCloudSandboxGatewayConnectionForWorkspace", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getProductToken.mockResolvedValue("product-token");
    isKnownCloudAgent.mockImplementation((kind) => kind === "claude" || kind === "codex");
    ensureRuntimeConnection.mockResolvedValue({
      gatewayAnyHarnessBaseUrl: "http://api.test/v1/gateway/cloud-sandbox/anyharness",
      anyharnessWorkspaceId: "repo-root-workspace",
      anyharnessRepoRootId: "repo-root",
      runtimeGeneration: 7,
    });
  });

  it("uses the authoritative cloud-sandbox runtime workspace id", async () => {
    const connection = await resolveCloudSandboxGatewayConnectionForWorkspace({
      id: "cloud-workspace-1",
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
      anyharnessWorkspaceId: "repo-root-workspace",
      runtimeGeneration: 7,
      runtimeAccessKind: "proliferate-gateway",
      anyharnessRepoRootId: "repo-root",
      allowedAgentKinds: ["claude"],
      readyAgentKinds: ["claude"],
    });
    expect(ensureRuntimeConnection).toHaveBeenCalledWith("cloud-workspace-1");
  });
});
