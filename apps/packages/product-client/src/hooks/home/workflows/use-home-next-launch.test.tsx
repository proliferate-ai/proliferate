// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderableOutboxEntriesForTranscript } from "@proliferate/product-domain/sessions/intents/session-intent-selectors";
import {
  buildPendingWorkspaceUiKey,
  buildSubmittingPendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry";
import {
  createEmptySessionRecord,
  getSessionRecord,
  putSessionRecord,
} from "#product/stores/sessions/session-records";
import {
  getPromptOutboxEntriesForSession,
  useSessionIntentStore,
} from "#product/stores/sessions/session-intent-store";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";
import { useChatLaunchIntentStore } from "#product/stores/chat/chat-launch-intent-store";
import { useDeferredHomeLaunchStore } from "#product/stores/home/deferred-home-launch-store";
import { useHomeNextLaunch } from "#product/hooks/home/workflows/use-home-next-launch";
import type { HomeLaunchTarget } from "#product/lib/domain/home/home-next-launch";
import { CoworkThreadLaunchProvider } from "#product/providers/CoworkThreadLaunchProvider";

const mocks = vi.hoisted(() => {
  const createThreadFromSelection = vi.fn();
  return {
    createCloudWorkspaceAndEnterWithResult: vi.fn(),
    createEmptySessionWithResolvedConfig: vi.fn(),
    createLocalWorkspaceAndEnterWithResult: vi.fn(),
    createSessionWithResolvedConfig: vi.fn(),
    createThreadFromSelection,
    createWorktreeAndEnterWithResult: vi.fn(),
    navigate: vi.fn(),
    productHost: { desktop: {} as object | null },
    selectWorkspace: vi.fn(),
    showToast: vi.fn(),
    useCoworkThreadWorkflow: vi.fn(() => ({ createThreadFromSelection })),
  };
});

vi.mock("react-router-dom", async (importOriginal) => ({
  ...await importOriginal<typeof import("react-router-dom")>(),
  useLocation: () => ({ pathname: "/" }),
  useNavigate: () => mocks.navigate,
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => mocks.productHost,
}));

vi.mock("#product/stores/toast/toast-store", () => ({
  useToastStore: (selector: (state: { show: typeof mocks.showToast }) => unknown) =>
    selector({ show: mocks.showToast }),
}));

vi.mock("#product/hooks/cloud/workflows/use-create-cloud-workspace", () => ({
  useCreateCloudWorkspace: () => ({
    createCloudWorkspaceAndEnterWithResult: mocks.createCloudWorkspaceAndEnterWithResult,
  }),
}));

vi.mock("#product/hooks/cowork/workflows/use-cowork-thread-workflow", () => ({
  useCoworkThreadWorkflow: mocks.useCoworkThreadWorkflow,
}));

vi.mock("#product/hooks/workspaces/workflows/use-workspace-entry-actions", () => ({
  useWorkspaceEntryActions: () => ({
    createLocalWorkspaceAndEnterWithResult: mocks.createLocalWorkspaceAndEnterWithResult,
    createWorktreeAndEnterWithResult: mocks.createWorktreeAndEnterWithResult,
  }),
}));

vi.mock("#product/hooks/workspaces/workflows/selection/use-workspace-selection", () => ({
  useWorkspaceSelection: () => ({
    selectWorkspace: mocks.selectWorkspace,
  }),
}));

vi.mock("#product/hooks/workspaces/cache/use-workspaces", () => ({
  useWorkspaces: () => ({ data: { workspaces: [] } }),
}));

vi.mock("#product/hooks/sessions/workflows/use-session-creation-actions", () => ({
  useSessionCreationActions: () => ({
    createEmptySessionWithResolvedConfig: mocks.createEmptySessionWithResolvedConfig,
    createSessionWithResolvedConfig: mocks.createSessionWithResolvedConfig,
  }),
}));

vi.mock("#product/hooks/workspaces/derived/use-workspace-runtime-block", () => ({
  useWorkspaceRuntimeBlock: () => ({
    getWorkspaceRuntimeBlockReason: () => null,
  }),
}));

vi.mock("#product/hooks/sessions/workflows/use-session-interaction-resolution-actions", () => ({
  useSessionInteractionResolutionActions: () => ({
    resolvePermission: vi.fn(),
    resolveMcpElicitation: vi.fn(),
    resolveUserInput: vi.fn(),
    revealMcpElicitationUrl: vi.fn(),
  }),
}));

function launchWrapper({ children }: { children: ReactNode }) {
  return <CoworkThreadLaunchProvider>{children}</CoworkThreadLaunchProvider>;
}

function renderHomeNextLaunch() {
  return renderHook(() => useHomeNextLaunch(), { wrapper: launchWrapper });
}

describe("useHomeNextLaunch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.productHost.desktop = {};
    useSessionDirectoryStore.getState().clearEntries();
    useSessionTranscriptStore.getState().clearEntries();
    useSessionIntentStore.getState().clear();
    useSessionSelectionStore.getState().clearSelection();
    useChatLaunchIntentStore.setState({ activeIntent: null });
    useDeferredHomeLaunchStore.setState({ launches: {} });
  });

  afterEach(cleanup);

  it("projects one destination prompt for a Home worktree launch", async () => {
    const sessionId = "client-session:codex:home-worktree";
    const pendingEntry = buildSubmittingPendingWorkspaceEntry({
      attemptId: "home-worktree-attempt",
      selectedWorkspaceId: null,
      source: "worktree-created",
      displayName: "home-worktree",
      repoLabel: "repo",
      baseBranchName: "main",
      request: {
        kind: "worktree",
        input: {
          repoRootId: "repo-root-1",
          sourceWorkspaceId: null,
          baseBranch: "main",
          defaultBranch: "main",
        },
      },
    });
    const pendingWorkspaceId = buildPendingWorkspaceUiKey(pendingEntry);

    mocks.createWorktreeAndEnterWithResult.mockImplementation(async () => {
      putSessionRecord(createEmptySessionRecord(sessionId, "codex", {
        workspaceId: pendingWorkspaceId,
        materializedSessionId: null,
        modelId: "gpt-5.4",
      }));
      useSessionSelectionStore.getState().enterPendingWorkspaceShell(pendingEntry, {
        initialActiveSessionId: sessionId,
      });
      return {
        workspaceId: "workspace-real",
        projectedSessionId: sessionId,
      };
    });

    const { result } = renderHomeNextLaunch();
    let succeeded = false;
    await act(async () => {
      succeeded = await result.current.launch({
        text: "build the projected destination",
        modelSelection: { kind: "codex", modelId: "gpt-5.4" },
        modeId: null,
        launchControlValues: {},
        target: {
          kind: "worktree",
          repoRootId: "repo-root-1",
          sourceWorkspaceId: null,
          baseBranch: "main",
          defaultBranch: "main",
        },
      });
    });

    const record = getSessionRecord(sessionId);
    const promptIntents = getPromptOutboxEntriesForSession(sessionId);
    const destinationPromptRows = record
      ? renderableOutboxEntriesForTranscript(promptIntents, record.transcript)
      : [];

    expect(succeeded).toBe(true);
    expect(promptIntents).toHaveLength(1);
    expect(destinationPromptRows).toHaveLength(1);
    expect(destinationPromptRows[0]?.text).toBe("build the projected destination");
    expect(mocks.createSessionWithResolvedConfig).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
  });

  it("does not invoke the Desktop Cowork workflow from Web Home", async () => {
    mocks.productHost.desktop = null;
    const { result } = renderHomeNextLaunch();

    let succeeded = true;
    await act(async () => {
      succeeded = await result.current.launch({
        text: "start cowork on web",
        modelSelection: { kind: "codex", modelId: "gpt-5.4" },
        modeId: null,
        launchControlValues: {},
        target: { kind: "cowork" },
      });
    });

    expect(succeeded).toBe(false);
    expect(result.current.isLaunching).toBe(false);
    expect(mocks.useCoworkThreadWorkflow).not.toHaveBeenCalled();
    expect(mocks.createThreadFromSelection).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(useChatLaunchIntentStore.getState().activeIntent).toBeNull();
    expect(mocks.showToast).toHaveBeenCalledWith(
      "Cowork threads are available in the Desktop app.",
      "info",
    );
  });

  it("still invokes the Cowork workflow from Desktop Home", async () => {
    mocks.createThreadFromSelection.mockResolvedValue(null);
    const { result } = renderHomeNextLaunch();

    await act(async () => {
      await result.current.launch({
        text: "start cowork on desktop",
        modelSelection: { kind: "codex", modelId: "gpt-5.4" },
        modeId: null,
        launchControlValues: {},
        target: { kind: "cowork" },
      });
    });

    expect(mocks.useCoworkThreadWorkflow).toHaveBeenCalledTimes(1);
    expect(mocks.createThreadFromSelection).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      label: "local",
      target: { kind: "local", sourceRoot: "/repo", existingWorkspaceId: null },
    },
    {
      label: "worktree",
      target: {
        kind: "worktree",
        repoRootId: "repo-root-1",
        sourceWorkspaceId: null,
        baseBranch: "main",
        defaultBranch: "main",
      },
    },
    {
      label: "SSH",
      target: { kind: "ssh" },
    },
  ])("rejects a forged $label launch before Web local workflows", async ({ target }) => {
    mocks.productHost.desktop = null;
    const { result } = renderHomeNextLaunch();

    let succeeded = true;
    await act(async () => {
      succeeded = await result.current.launch({
        text: "do not launch locally",
        modelSelection: { kind: "codex", modelId: "gpt-5.4" },
        modeId: null,
        launchControlValues: {},
        target: target as HomeLaunchTarget,
      });
    });

    expect(succeeded).toBe(false);
    expect(mocks.useCoworkThreadWorkflow).not.toHaveBeenCalled();
    expect(mocks.createLocalWorkspaceAndEnterWithResult).not.toHaveBeenCalled();
    expect(mocks.createWorktreeAndEnterWithResult).not.toHaveBeenCalled();
    expect(mocks.createCloudWorkspaceAndEnterWithResult).not.toHaveBeenCalled();
    expect(useChatLaunchIntentStore.getState().activeIntent).toBeNull();
    expect(mocks.showToast).toHaveBeenCalledWith(
      "Local launch targets are available in the Desktop app.",
      "info",
    );
  });

  it("still invokes the Cloud workflow from Web Home", async () => {
    mocks.productHost.desktop = null;
    mocks.createCloudWorkspaceAndEnterWithResult.mockResolvedValue({
      status: "interrupted",
      failureMessage: "Expected test interruption",
    });
    const { result } = renderHomeNextLaunch();

    await act(async () => {
      await result.current.launch({
        text: "launch in cloud",
        modelSelection: { kind: "codex", modelId: "gpt-5.4" },
        modeId: null,
        launchControlValues: {},
        target: {
          kind: "cloud",
          gitOwner: "proliferate-ai",
          gitRepoName: "proliferate",
          baseBranch: "main",
        },
      });
    });

    expect(mocks.useCoworkThreadWorkflow).not.toHaveBeenCalled();
    expect(mocks.createCloudWorkspaceAndEnterWithResult).toHaveBeenCalledTimes(1);
    expect(mocks.createLocalWorkspaceAndEnterWithResult).not.toHaveBeenCalled();
    expect(mocks.createWorktreeAndEnterWithResult).not.toHaveBeenCalled();
  });
});
