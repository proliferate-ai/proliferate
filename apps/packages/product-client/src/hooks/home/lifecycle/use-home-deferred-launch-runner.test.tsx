// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { CloudWorkspaceSummary } from "#product/lib/domain/workspaces/cloud/cloud-workspace-model";
import type { CreateSessionWithResolvedConfigOptions } from "#product/hooks/sessions/workflows/session-creation-types";
import { createPromptAttachmentSnapshot } from "#product/domain/chats/composer/prompt-attachment-snapshot";
import {
  buildPendingWorkspaceUiKey,
} from "#product/lib/domain/workspaces/creation/pending-entry";
import {
  EMPTY_PENDING_WORKSPACE_REGISTRY,
  upsertPendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry-registry";
import {
  useDeferredHomeLaunchStore,
  type DeferredHomeLaunch,
} from "#product/stores/home/deferred-home-launch-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useHomeDeferredLaunchRunner } from "#product/hooks/home/lifecycle/use-home-deferred-launch-runner";
import {
  awaitingCloudWorkspaceEntryFixture as awaitingEntry,
  cloudWorkspaceFixture as cloudWorkspace,
} from "#product/test/cloud-workspace-fixtures";

const mocks = vi.hoisted(() => ({
  createSessionWithResolvedConfig: vi.fn(),
  notifyQueuedPromptSendFailure: vi.fn(),
  selectWorkspace: vi.fn(),
  workspaceCollections: {
    cloudWorkspaces: [] as CloudWorkspaceSummary[],
  },
}));

vi.mock("#product/hooks/sessions/workflows/queued-prompt-failure-notice", () => ({
  notifyQueuedPromptSendFailure: mocks.notifyQueuedPromptSendFailure,
}));

vi.mock("#product/hooks/workspaces/workflows/selection/use-workspace-selection", () => ({
  useWorkspaceSelection: () => ({ selectWorkspace: mocks.selectWorkspace }),
}));

vi.mock("#product/hooks/workspaces/cache/use-workspaces", () => ({
  useWorkspaces: () => ({
    data: mocks.workspaceCollections,
    isSuccess: true,
  }),
}));

vi.mock("#product/hooks/sessions/workflows/use-session-creation-actions", () => ({
  useSessionCreationActions: () => ({
    createSessionWithResolvedConfig: mocks.createSessionWithResolvedConfig,
  }),
}));

describe("useHomeDeferredLaunchRunner", () => {
  beforeEach(() => {
    mocks.createSessionWithResolvedConfig.mockReset();
    mocks.notifyQueuedPromptSendFailure.mockReset();
    mocks.selectWorkspace.mockReset();
    mocks.selectWorkspace.mockResolvedValue(undefined);
    // Standing in for the real create: activating a session is exactly the
    // camera move a background promotion must not make.
    mocks.createSessionWithResolvedConfig.mockImplementation(
      async (options: CreateSessionWithResolvedConfigOptions) => {
        const sessionId = `session-for:${options.workspaceId}`;
        if (options.activateOnCreate !== false) {
          useSessionSelectionStore.setState({
            activeSessionId: sessionId,
            selectedWorkspaceId: options.workspaceId ?? null,
          });
        }
        return sessionId;
      },
    );
    mocks.workspaceCollections.cloudWorkspaces = [];
    useDeferredHomeLaunchStore.setState({ launches: {} });
    useSessionSelectionStore.setState({
      pendingWorkspaces: EMPTY_PENDING_WORKSPACE_REGISTRY,
      selectedLogicalWorkspaceId: null,
      selectedWorkspaceId: null,
      activeSessionId: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("promotes a background launch without stealing selection or the active session", async () => {
    mocks.workspaceCollections.cloudWorkspaces = [cloudWorkspace({ status: "ready" })];
    enqueueLaunch(deferredLaunch());
    useSessionSelectionStore.setState({
      selectedWorkspaceId: "cloud:other",
      selectedLogicalWorkspaceId: "cloud:other",
      activeSessionId: "session-in-other-workspace",
    });

    renderHook(() => useHomeDeferredLaunchRunner());

    await waitFor(() => {
      expect(mocks.createSessionWithResolvedConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "cloud:cloud-1",
          text: "run the migration",
          activateOnCreate: false,
          targetWorkspaceUiKey: "cloud:cloud-1",
        }),
      );
    });
    const selection = useSessionSelectionStore.getState();
    expect(selection.activeSessionId).toBe("session-in-other-workspace");
    expect(selection.selectedWorkspaceId).toBe("cloud:other");
    await waitFor(() => {
      expect(useDeferredHomeLaunchStore.getState().launches["cloud-1:attempt-1"]).toBeUndefined();
    });
  });

  it("still activates the created session when the user is attending the launch", async () => {
    mocks.workspaceCollections.cloudWorkspaces = [cloudWorkspace({ status: "ready" })];
    enqueueLaunch(deferredLaunch());
    useSessionSelectionStore.setState({
      selectedWorkspaceId: "cloud:cloud-1",
      selectedLogicalWorkspaceId: "cloud:cloud-1",
    });

    renderHook(() => useHomeDeferredLaunchRunner());

    await waitFor(() => {
      expect(mocks.createSessionWithResolvedConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "cloud:cloud-1",
          activateOnCreate: true,
          targetWorkspaceUiKey: null,
        }),
      );
    });
    await waitFor(() => {
      expect(useSessionSelectionStore.getState().activeSessionId)
        .toBe("session-for:cloud:cloud-1");
    });
  });

  it("treats the pending shell of an attended attempt as attended", async () => {
    mocks.workspaceCollections.cloudWorkspaces = [cloudWorkspace({ status: "ready" })];
    const entry = awaitingEntry("attempt-1", "cloud:cloud-1");
    enqueueLaunch(deferredLaunch());
    useSessionSelectionStore.setState({
      pendingWorkspaces: upsertPendingWorkspaceEntry(EMPTY_PENDING_WORKSPACE_REGISTRY, entry),
      selectedLogicalWorkspaceId: buildPendingWorkspaceUiKey(entry),
      selectedWorkspaceId: null,
    });

    renderHook(() => useHomeDeferredLaunchRunner());

    await waitFor(() => {
      expect(mocks.createSessionWithResolvedConfig).toHaveBeenCalledWith(
        expect.objectContaining({ activateOnCreate: true }),
      );
    });
  });

  it("promotes two deferred launches independently", async () => {
    mocks.workspaceCollections.cloudWorkspaces = [
      cloudWorkspace({ status: "ready" }),
      cloudWorkspace({ id: "cloud-2", status: "ready" }),
    ];
    enqueueLaunch(deferredLaunch());
    enqueueLaunch(deferredLaunch({
      id: "cloud-2:attempt-2",
      workspaceId: "cloud:cloud-2",
      cloudWorkspaceId: "cloud-2",
      cloudAttemptId: "attempt-2",
      promptText: "run the backfill",
    }));

    renderHook(() => useHomeDeferredLaunchRunner());

    await waitFor(() => {
      expect(mocks.createSessionWithResolvedConfig).toHaveBeenCalledTimes(2);
    });
    expect(mocks.createSessionWithResolvedConfig.mock.calls.map(([options]) => options.workspaceId))
      .toEqual(["cloud:cloud-1", "cloud:cloud-2"]);
    await waitFor(() => {
      expect(Object.keys(useDeferredHomeLaunchStore.getState().launches)).toEqual([]);
    });
  });

  it("waits while one launch's workspace is still provisioning", async () => {
    mocks.workspaceCollections.cloudWorkspaces = [
      cloudWorkspace({ status: "ready" }),
      cloudWorkspace({ id: "cloud-2", status: "pending" }),
    ];
    enqueueLaunch(deferredLaunch());
    enqueueLaunch(deferredLaunch({
      id: "cloud-2:attempt-2",
      workspaceId: "cloud:cloud-2",
      cloudWorkspaceId: "cloud-2",
      cloudAttemptId: "attempt-2",
    }));

    renderHook(() => useHomeDeferredLaunchRunner());

    await waitFor(() => {
      expect(mocks.createSessionWithResolvedConfig).toHaveBeenCalledTimes(1);
    });
    expect(useDeferredHomeLaunchStore.getState().launches["cloud-2:attempt-2"]?.status)
      .toBe("pending");
  });

  it("forwards the queued attachment snapshots when the prompt replays", async () => {
    // PRO-230 remainder (#1893) dropped `attachmentSnapshots` from this call,
    // silently discarding any file attached while the cloud workspace was
    // still provisioning. Every other launch path threads it through
    // `promptAttachmentSendFields`; this asserts the deferred path does too.
    mocks.workspaceCollections.cloudWorkspaces = [cloudWorkspace({ status: "ready" })];
    const attachment = createPromptAttachmentSnapshot({
      id: "attachment-1",
      name: "notes.txt",
      mimeType: "text/plain",
      size: 42,
      kind: "text_resource",
      source: "upload",
    }, { tag: "file" });
    enqueueLaunch(deferredLaunch({ attachmentSnapshots: [attachment] }));

    renderHook(() => useHomeDeferredLaunchRunner());

    await waitFor(() => {
      expect(mocks.createSessionWithResolvedConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "run the migration",
          attachmentSnapshots: [attachment],
          optimisticContentParts: expect.arrayContaining([
            expect.objectContaining({ type: "text", text: "run the migration" }),
            expect.objectContaining({ type: "resource", name: "notes.txt" }),
          ]),
        }),
      );
    });
  });

  it("announces a background send failure with its workspace instead of the composer copy", async () => {
    // The create resolves at prompt enqueue, so the failure arrives on the
    // callback rather than the await below. Unattended it must not be reported
    // as "your message is still in the composer" — there is no composer holding
    // it, and the toast would name no workspace (PRO-230 review finding 3).
    mocks.workspaceCollections.cloudWorkspaces = [cloudWorkspace({ status: "ready" })];
    mocks.createSessionWithResolvedConfig.mockImplementation(
      async (options: CreateSessionWithResolvedConfigOptions) => {
        options.onQueuedPromptFailure?.(new Error("Runtime gateway refused the prompt"));
        return "session-1";
      },
    );
    enqueueLaunch(deferredLaunch());
    useSessionSelectionStore.setState({
      selectedWorkspaceId: "cloud:other",
      selectedLogicalWorkspaceId: "cloud:other",
    });

    renderHook(() => useHomeDeferredLaunchRunner());

    await waitFor(() => {
      expect(mocks.notifyQueuedPromptSendFailure).toHaveBeenCalledTimes(1);
    });
    const notice = mocks.notifyQueuedPromptSendFailure.mock.calls[0]?.[0];
    expect(notice).toMatchObject({
      workspaceId: "cloud:cloud-1",
      workspaceName: "feature-branch",
    });
    expect(notice.cause).toContain("Runtime gateway refused the prompt");

    // Its Show action opens the workspace the prompt was meant for.
    notice.showWorkspace();
    expect(mocks.selectWorkspace).toHaveBeenCalledWith("cloud:cloud-1", { force: true });
  });

  it("leaves an attended send failure to the composer-owned announcement", async () => {
    mocks.workspaceCollections.cloudWorkspaces = [cloudWorkspace({ status: "ready" })];
    enqueueLaunch(deferredLaunch());
    useSessionSelectionStore.setState({
      selectedWorkspaceId: "cloud:cloud-1",
      selectedLogicalWorkspaceId: "cloud:cloud-1",
    });

    renderHook(() => useHomeDeferredLaunchRunner());

    await waitFor(() => {
      expect(mocks.createSessionWithResolvedConfig).toHaveBeenCalledTimes(1);
    });
    // No callback passed: the user is watching this launch and their composer
    // does hold the text, so the creation workflow's own copy is correct.
    const options = mocks.createSessionWithResolvedConfig.mock.calls[0]?.[0];
    expect(options.onQueuedPromptFailure).toBeUndefined();
    expect(mocks.notifyQueuedPromptSendFailure).not.toHaveBeenCalled();
  });

  it("releases the queued prompt when the launch's attempt failed", async () => {
    mocks.workspaceCollections.cloudWorkspaces = [cloudWorkspace({ status: "pending" })];
    enqueueLaunch(deferredLaunch());
    useSessionSelectionStore.setState({
      pendingWorkspaces: upsertPendingWorkspaceEntry(
        EMPTY_PENDING_WORKSPACE_REGISTRY,
        { ...awaitingEntry("attempt-1", "cloud:cloud-1"), stage: "failed" },
      ),
    });

    renderHook(() => useHomeDeferredLaunchRunner());

    await waitFor(() => {
      expect(useDeferredHomeLaunchStore.getState().launches["cloud-1:attempt-1"]).toBeUndefined();
    });
    expect(mocks.createSessionWithResolvedConfig).not.toHaveBeenCalled();
  });
});

function deferredLaunch(
  overrides: Partial<DeferredHomeLaunch> = {},
): DeferredHomeLaunch {
  return {
    id: "cloud-1:attempt-1",
    status: "pending",
    workspaceId: "cloud:cloud-1",
    cloudWorkspaceId: "cloud-1",
    cloudAttemptId: "attempt-1",
    agentKind: "claude",
    modelId: "claude-sonnet-4.5",
    promptText: "run the migration",
    promptId: "prompt-1",
    launchIntentId: "intent-1",
    createdAt: Date.now(),
    ...overrides,
  };
}

function enqueueLaunch(launch: DeferredHomeLaunch) {
  useDeferredHomeLaunchStore.getState().enqueue(launch);
}
