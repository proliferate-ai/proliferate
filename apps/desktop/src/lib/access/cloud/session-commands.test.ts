import { enqueueCommand, getCommandStatus } from "@proliferate/cloud-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  sendCloudPromptCommand,
  startCloudSessionCommand,
  startCloudSessionCommandResult,
} from "@/lib/access/cloud/session-commands";

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

  it("returns the AnyHarness session body from accepted start commands", async () => {
    enqueueCommandMock.mockResolvedValue({
      commandId: "command-1",
      targetId: "target-1",
      kind: "start_session",
      source: "desktop_cloud_view",
      status: "queued",
      createdAt: "2026-05-25T00:00:00Z",
      updatedAt: "2026-05-25T00:00:00Z",
    } as Awaited<ReturnType<typeof enqueueCommand>>);
    getCommandStatusMock.mockResolvedValue({
      commandId: "command-1",
      targetId: "target-1",
      kind: "start_session",
      source: "desktop_cloud_view",
      status: "accepted",
      createdAt: "2026-05-25T00:00:00Z",
      updatedAt: "2026-05-25T00:00:01Z",
      result: {
        body: {
          id: "session-1",
          workspaceId: "anyharness-workspace-1",
          agentKind: "codex",
          status: "idle",
          createdAt: "2026-05-25T00:00:00Z",
          updatedAt: "2026-05-25T00:00:01Z",
          actionCapabilities: {},
        },
      },
    } as Awaited<ReturnType<typeof getCommandStatus>>);

    const result = await startCloudSessionCommandResult({
      idempotencyKey: "start-session-1",
      targetId: "target-1",
      cloudWorkspaceId: "cloud-workspace-1",
      anyharnessWorkspaceId: "anyharness-workspace-1",
      agentKind: "codex",
      modelId: "gpt-5.5",
      modeId: "auto",
      subagentsEnabled: true,
    });

    expect(result.sessionId).toBe("session-1");
    expect(result.session?.id).toBe("session-1");
  });

  it("sends prompts through cloud commands and returns prompt responses", async () => {
    enqueueCommandMock.mockResolvedValue({
      commandId: "command-2",
      targetId: "target-1",
      kind: "send_prompt",
      source: "desktop_cloud_view",
      status: "queued",
      createdAt: "2026-05-25T00:00:00Z",
      updatedAt: "2026-05-25T00:00:00Z",
    } as Awaited<ReturnType<typeof enqueueCommand>>);
    getCommandStatusMock.mockResolvedValue({
      commandId: "command-2",
      targetId: "target-1",
      kind: "send_prompt",
      source: "desktop_cloud_view",
      status: "accepted",
      createdAt: "2026-05-25T00:00:00Z",
      updatedAt: "2026-05-25T00:00:01Z",
      result: {
        body: {
          status: "running",
          queuedSeq: null,
          session: {
            id: "session-1",
            workspaceId: "anyharness-workspace-1",
            agentKind: "codex",
            status: "running",
            createdAt: "2026-05-25T00:00:00Z",
            updatedAt: "2026-05-25T00:00:01Z",
            actionCapabilities: {},
          },
        },
      },
    } as Awaited<ReturnType<typeof getCommandStatus>>);

    const result = await sendCloudPromptCommand({
      idempotencyKey: "send-prompt-1",
      targetId: "target-1",
      cloudWorkspaceId: "cloud-workspace-1",
      anyharnessWorkspaceId: "anyharness-workspace-1",
      sessionId: "session-1",
      promptId: "prompt-1",
      blocks: [{ type: "text", text: "hello" }],
      text: "hello",
    });

    expect(result?.status).toBe("running");
    expect(result?.session.id).toBe("session-1");
    expect(enqueueCommandMock.mock.calls[0]?.[0]).toMatchObject({
      idempotencyKey: "send-prompt-1",
      targetId: "target-1",
      workspaceId: "anyharness-workspace-1",
      cloudWorkspaceId: "cloud-workspace-1",
      sessionId: "session-1",
      kind: "send_prompt",
      payload: {
        promptId: "prompt-1",
        blocks: [{ type: "text", text: "hello" }],
        text: "hello",
      },
    });
  });

  it("backfills a missing Cloud projection and retries prompt dispatch once", async () => {
    const missingProjectionError = Object.assign(
      new Error("Session is not projected into Cloud."),
      {
        status: 409,
        code: "cloud_command_session_not_projected",
      },
    );
    enqueueCommandMock
      .mockRejectedValueOnce(missingProjectionError)
      .mockResolvedValueOnce({
        commandId: "backfill-command",
        targetId: "target-1",
        kind: "backfill_exposed_workspace",
        source: "desktop_cloud_view",
        status: "queued",
        createdAt: "2026-05-25T00:00:00Z",
        updatedAt: "2026-05-25T00:00:00Z",
      } as Awaited<ReturnType<typeof enqueueCommand>>)
      .mockResolvedValueOnce({
        commandId: "send-command",
        targetId: "target-1",
        kind: "send_prompt",
        source: "desktop_cloud_view",
        status: "queued",
        createdAt: "2026-05-25T00:00:01Z",
        updatedAt: "2026-05-25T00:00:01Z",
      } as Awaited<ReturnType<typeof enqueueCommand>>);
    getCommandStatusMock
      .mockResolvedValueOnce({
        commandId: "backfill-command",
        targetId: "target-1",
        kind: "backfill_exposed_workspace",
        source: "desktop_cloud_view",
        status: "accepted",
        createdAt: "2026-05-25T00:00:00Z",
        updatedAt: "2026-05-25T00:00:01Z",
        result: {
          mappedWorkspaceCount: 1,
          mappedSessionCount: 1,
        },
      } as Awaited<ReturnType<typeof getCommandStatus>>)
      .mockResolvedValueOnce({
        commandId: "send-command",
        targetId: "target-1",
        kind: "send_prompt",
        source: "desktop_cloud_view",
        status: "accepted",
        createdAt: "2026-05-25T00:00:01Z",
        updatedAt: "2026-05-25T00:00:02Z",
        result: {
          body: {
            status: "running",
            queuedSeq: null,
            session: {
              id: "session-1",
              workspaceId: "anyharness-workspace-1",
              agentKind: "claude",
              status: "running",
              createdAt: "2026-05-25T00:00:00Z",
              updatedAt: "2026-05-25T00:00:02Z",
              actionCapabilities: {},
            },
          },
        },
      } as Awaited<ReturnType<typeof getCommandStatus>>);

    const result = await sendCloudPromptCommand({
      idempotencyKey: "send-prompt-1",
      targetId: "target-1",
      cloudWorkspaceId: "cloud-workspace-1",
      anyharnessWorkspaceId: "anyharness-workspace-1",
      sessionId: "session-1",
      promptId: "prompt-1",
      blocks: [{ type: "text", text: "hello" }],
      text: "hello",
    });

    expect(result?.session.id).toBe("session-1");
    expect(enqueueCommandMock).toHaveBeenCalledTimes(3);
    expect(enqueueCommandMock.mock.calls[1]?.[0]).toMatchObject({
      idempotencyKey: "desktop:backfill-session-projection:cloud-workspace-1:session-1:prompt-1",
      targetId: "target-1",
      workspaceId: "anyharness-workspace-1",
      cloudWorkspaceId: "cloud-workspace-1",
      kind: "backfill_exposed_workspace",
      source: "desktop_cloud_view",
      payload: {
        workspaceId: "anyharness-workspace-1",
      },
    });
    expect(enqueueCommandMock.mock.calls[2]?.[0]).toMatchObject({
      idempotencyKey: "send-prompt-1",
      kind: "send_prompt",
      sessionId: "session-1",
    });
  });

  it("surfaces actionable AnyHarness problem details from failed cloud starts", async () => {
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
      status: "failed_delivery",
      errorMessage: "AnyHarness returned HTTP 409 Conflict",
      createdAt: "2026-05-25T00:00:00Z",
      updatedAt: "2026-05-25T00:00:01Z",
      result: {
        anyharnessStatusCode: 409,
        body: {
          code: "AGENT_AUTH_SELECTION_REQUIRED",
          title: "Agent auth selection required",
          detail: "Agent auth selection for claude is required before launch (missing).",
        },
      },
    } as Awaited<ReturnType<typeof getCommandStatus>>);

    await expect(startCloudSessionCommand({
      idempotencyKey: "start-session-1",
      targetId: "target-1",
      cloudWorkspaceId: "cloud-workspace-1",
      anyharnessWorkspaceId: "anyharness-workspace-1",
      agentKind: "claude",
      modelId: "sonnet",
      modeId: "default",
      subagentsEnabled: true,
    })).rejects.toThrow(
      "Agent auth selection for claude is required before launch (missing). Choose a cloud-ready model or configure cloud agent auth.",
    );
  });
});
