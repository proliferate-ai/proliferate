import { enqueueCommand, getCommandStatus } from "@proliferate/cloud-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { startCloudSessionCommand } from "@/lib/access/cloud/session-commands";

vi.mock("@proliferate/cloud-sdk", () => ({
  enqueueCommand: vi.fn(),
  getCommandStatus: vi.fn(),
}));

const enqueueCommandMock = vi.mocked(enqueueCommand);
const getCommandStatusMock = vi.mocked(getCommandStatus);

describe("startCloudSessionCommand", () => {
  beforeEach(() => {
    enqueueCommandMock.mockReset();
    getCommandStatusMock.mockReset();
  });

  it("routes desktop-dispatch session starts through the payload workspace id", async () => {
    enqueueCommandMock.mockResolvedValue({
      commandId: "command-1",
      idempotencyKey: "start-session-1",
      targetId: "target-1",
      kind: "start_session",
      source: "desktop_cloud_view",
      status: "queued",
      createdAt: "2026-05-25T00:00:00Z",
      updatedAt: "2026-05-25T00:00:00Z",
    } as Awaited<ReturnType<typeof enqueueCommand>>);
    getCommandStatusMock.mockResolvedValue({
      commandId: "command-1",
      idempotencyKey: "start-session-1",
      targetId: "target-1",
      kind: "start_session",
      source: "desktop_cloud_view",
      status: "accepted",
      createdAt: "2026-05-25T00:00:00Z",
      updatedAt: "2026-05-25T00:00:01Z",
      result: { sessionId: "session-1" },
    } as Awaited<ReturnType<typeof getCommandStatus>>);

    const sessionId = await startCloudSessionCommand({
      idempotencyKey: "start-session-1",
      targetId: "target-1",
      cloudWorkspaceId: "cloud-workspace-1",
      anyharnessWorkspaceId: "anyharness-workspace-1",
      agentKind: "claude",
      modelId: "sonnet",
      modeId: "default",
      subagentsEnabled: true,
    });

    expect(sessionId).toBe("session-1");
    expect(enqueueCommandMock).toHaveBeenCalledTimes(1);
    const request = enqueueCommandMock.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      idempotencyKey: "start-session-1",
      targetId: "target-1",
      cloudWorkspaceId: "cloud-workspace-1",
      kind: "start_session",
      source: "desktop_cloud_view",
      payload: {
        workspaceId: "anyharness-workspace-1",
        agentKind: "claude",
        modelId: "sonnet",
        modeId: "default",
        subagentsEnabled: true,
      },
    });
    expect(request).not.toHaveProperty("workspaceId");
  });
});
