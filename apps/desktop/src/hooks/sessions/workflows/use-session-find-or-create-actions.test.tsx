// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEmptySessionRecord,
  putSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useSessionFindOrCreateActions } from "@/hooks/sessions/workflows/use-session-find-or-create-actions";

const mocks = vi.hoisted(() => ({
  getWorkspaceRuntimeBlockReason: vi.fn(() => null),
  promptSession: vi.fn(async () => undefined),
}));

vi.mock("@/hooks/workspaces/derived/use-workspace-runtime-block", () => ({
  useWorkspaceRuntimeBlock: () => ({
    getWorkspaceRuntimeBlockReason: mocks.getWorkspaceRuntimeBlockReason,
  }),
}));

vi.mock("@/hooks/sessions/workflows/use-session-prompt-workflow", () => ({
  useSessionPromptWorkflow: () => ({
    promptSession: mocks.promptSession,
  }),
}));

describe("useSessionFindOrCreateActions", () => {
  beforeEach(() => {
    mocks.getWorkspaceRuntimeBlockReason.mockClear();
    mocks.promptSession.mockClear();
    useSessionDirectoryStore.getState().clearEntries();
    useSessionTranscriptStore.getState().clearEntries();
    useWorkspaceUiStore.setState({
      activeShellTabKeyByWorkspace: {},
      shellActivationEpochByWorkspace: {},
    });
    useSessionSelectionStore.setState({
      selectedWorkspaceId: "workspace-1",
      activeSessionId: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("materializes a reusable projected session before sending its first prompt", async () => {
    putSessionRecord(createEmptySessionRecord("client-session:codex:1", "codex", {
      workspaceId: "workspace-1",
      materializedSessionId: null,
      modelId: "gpt-5.5",
      modeId: "full-access",
    }));
    const deps = actionDeps();
    const { result } = renderHook(() => useSessionFindOrCreateActions(deps));

    await act(async () => {
      await result.current.findOrCreateSession(
        "codex",
        "hello",
        "gpt-5.5",
        [{ type: "text", text: "hello" }],
        undefined,
        undefined,
        undefined,
        null,
        "prompt-1",
      );
    });

    expect(deps.activateSession).toHaveBeenCalledWith("client-session:codex:1");
    expect(deps.createSessionWithResolvedConfig).toHaveBeenCalledWith({
      text: "hello",
      blocks: [{ type: "text", text: "hello" }],
      attachmentSnapshots: undefined,
      optimisticContentParts: undefined,
      agentKind: "codex",
      modelId: "gpt-5.5",
      modeId: "full-access",
      workspaceId: "workspace-1",
      clientSessionId: "client-session:codex:1",
      onBeforeOptimisticPrompt: undefined,
      measurementOperationId: null,
      promptId: "prompt-1",
      preferExistingCompatibleSession: true,
    });
    expect(mocks.promptSession).not.toHaveBeenCalled();
    expect(deps.ensureWorkspaceSessions).not.toHaveBeenCalled();
  });

  it("materializes a projected launch-session reuse before dispatching", async () => {
    putSessionRecord(createEmptySessionRecord("client-session:codex:2", "codex", {
      workspaceId: "workspace-1",
      materializedSessionId: null,
      modelId: "gpt-5.5",
      modeId: "full-access",
    }));
    const deps = actionDeps();
    const { result } = renderHook(() => useSessionFindOrCreateActions(deps));

    await act(async () => {
      await result.current.findOrCreateSessionForLaunch({
        workspaceId: "workspace-1",
        agentKind: "codex",
        modelId: "gpt-5.5",
        text: "launch hello",
        blocks: [{ type: "text", text: "launch hello" }],
        latencyFlowId: "latency-1",
        promptId: "prompt-2",
      });
    });

    expect(deps.createSessionWithResolvedConfig).toHaveBeenCalledWith({
      text: "launch hello",
      blocks: [{ type: "text", text: "launch hello" }],
      attachmentSnapshots: undefined,
      optimisticContentParts: undefined,
      agentKind: "codex",
      modelId: "gpt-5.5",
      modeId: "full-access",
      workspaceId: "workspace-1",
      latencyFlowId: "latency-1",
      promptId: "prompt-2",
      clientSessionId: "client-session:codex:2",
      onBeforeOptimisticPrompt: undefined,
      preferExistingCompatibleSession: true,
    });
    expect(mocks.promptSession).not.toHaveBeenCalled();
    expect(deps.ensureWorkspaceSessions).not.toHaveBeenCalled();
  });

  it("queues prompts against an already-starting projected session", async () => {
    putSessionRecord({
      ...createEmptySessionRecord("client-session:codex:3", "codex", {
        workspaceId: "workspace-1",
        materializedSessionId: null,
        modelId: "gpt-5.5",
      }),
      status: "starting",
    });
    const deps = actionDeps();
    const { result } = renderHook(() => useSessionFindOrCreateActions(deps));

    await act(async () => {
      await result.current.findOrCreateSession(
        "codex",
        "hello again",
        "gpt-5.5",
        [{ type: "text", text: "hello again" }],
        undefined,
        undefined,
        undefined,
        null,
        "prompt-3",
      );
    });

    expect(deps.activateSession).toHaveBeenCalledWith("client-session:codex:3");
    expect(deps.createSessionWithResolvedConfig).not.toHaveBeenCalled();
    expect(mocks.promptSession).toHaveBeenCalledWith({
      sessionId: "client-session:codex:3",
      text: "hello again",
      blocks: [{ type: "text", text: "hello again" }],
      attachmentSnapshots: undefined,
      optimisticContentParts: undefined,
      workspaceId: "workspace-1",
      onBeforeOptimisticPrompt: undefined,
      measurementOperationId: null,
      promptId: "prompt-3",
    });
    expect(deps.ensureWorkspaceSessions).not.toHaveBeenCalled();
  });

  it("queues launch prompts against an already-starting projected session", async () => {
    putSessionRecord({
      ...createEmptySessionRecord("client-session:codex:4", "codex", {
        workspaceId: "workspace-1",
        materializedSessionId: null,
        modelId: "gpt-5.5",
      }),
      status: "starting",
    });
    const deps = actionDeps();
    const { result } = renderHook(() => useSessionFindOrCreateActions(deps));

    await act(async () => {
      await result.current.findOrCreateSessionForLaunch({
        workspaceId: "workspace-1",
        agentKind: "codex",
        modelId: "gpt-5.5",
        text: "launch again",
        blocks: [{ type: "text", text: "launch again" }],
        latencyFlowId: "latency-2",
        promptId: "prompt-4",
      });
    });

    expect(deps.activateSession).toHaveBeenCalledWith("client-session:codex:4");
    expect(deps.createSessionWithResolvedConfig).not.toHaveBeenCalled();
    expect(mocks.promptSession).toHaveBeenCalledWith({
      sessionId: "client-session:codex:4",
      text: "launch again",
      blocks: [{ type: "text", text: "launch again" }],
      attachmentSnapshots: undefined,
      optimisticContentParts: undefined,
      workspaceId: "workspace-1",
      latencyFlowId: "latency-2",
      promptId: "prompt-4",
      onBeforeOptimisticPrompt: undefined,
    });
    expect(deps.ensureWorkspaceSessions).not.toHaveBeenCalled();
  });
});

function actionDeps() {
  return {
    activateSession: vi.fn(),
    createSessionWithResolvedConfig: vi.fn(async () => "client-session:codex:1"),
    ensureWorkspaceSessions: vi.fn(async () => []),
    selectSession: vi.fn(async () => undefined),
  };
}
