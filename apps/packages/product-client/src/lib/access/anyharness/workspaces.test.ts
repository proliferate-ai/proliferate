import { beforeEach, describe, expect, it, vi } from "vitest";
import { listRuntimeWorkspaces } from "#product/lib/access/anyharness/workspaces";

const clientMocks = vi.hoisted(() => ({
  workspacesList: vi.fn(),
  getAnyHarnessClient: vi.fn(),
}));

vi.mock("@anyharness/sdk-react", () => ({
  getAnyHarnessClient: clientMocks.getAnyHarnessClient,
}));

describe("AnyHarness workspace list access", () => {
  beforeEach(() => {
    clientMocks.workspacesList.mockReset();
    clientMocks.getAnyHarnessClient.mockReset();
    clientMocks.getAnyHarnessClient.mockReturnValue({
      workspaces: { list: clientMocks.workspacesList },
    });
    clientMocks.workspacesList.mockResolvedValue([]);
  });

  it("leaves the lifecycle filter unset so the server's active default applies", async () => {
    await listRuntimeWorkspaces({ runtimeUrl: "http://runtime" });

    expect(clientMocks.workspacesList).toHaveBeenCalledWith(undefined, undefined);
  });

  it("forwards request options as options, never as the lifecycle filter", async () => {
    const signal = new AbortController().signal;

    await listRuntimeWorkspaces({ runtimeUrl: "http://runtime" }, undefined, { signal });

    expect(clientMocks.workspacesList).toHaveBeenCalledWith(undefined, { signal });
  });
});
