import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureManagedSandboxWorkspaceRuntimeConnection,
} from "@proliferate/cloud-sdk/client/managed-sandboxes";
import {
  getDesktopCloudAccessToken,
  isCloudAgentKind,
  type CloudWorkspaceDetail,
} from "@/lib/access/cloud/client";
import {
  resolveManagedSandboxGatewayConnectionForWorkspace,
} from "@/lib/access/cloud/managed-sandbox-gateway";

vi.mock("@proliferate/cloud-sdk/client/managed-sandboxes", () => ({
  ensureManagedSandboxWorkspaceRuntimeConnection: vi.fn(),
}));

vi.mock("@/lib/access/cloud/client", () => ({
  getDesktopCloudAccessToken: vi.fn(),
  isCloudAgentKind: vi.fn(),
}));

const ensureRuntimeConnection = vi.mocked(ensureManagedSandboxWorkspaceRuntimeConnection);
const getProductToken = vi.mocked(getDesktopCloudAccessToken);
const isKnownCloudAgent = vi.mocked(isCloudAgentKind);

describe("resolveManagedSandboxGatewayConnectionForWorkspace", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getProductToken.mockResolvedValue("product-token");
    isKnownCloudAgent.mockImplementation((kind) => kind === "claude" || kind === "codex");
    ensureRuntimeConnection.mockResolvedValue({
      gatewayAnyHarnessBaseUrl: "http://api.test/v1/gateway/managed-sandbox/anyharness",
      anyharnessWorkspaceId: "repo-root-workspace",
      anyharnessRepoRootId: "repo-root",
      runtimeGeneration: 7,
    });
  });

  it("uses the authoritative managed-sandbox runtime workspace id", async () => {
    const connection = await resolveManagedSandboxGatewayConnectionForWorkspace({
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
    } as CloudWorkspaceDetail);

    expect(connection).toMatchObject({
      runtimeUrl: "http://api.test/v1/gateway/managed-sandbox/anyharness",
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
