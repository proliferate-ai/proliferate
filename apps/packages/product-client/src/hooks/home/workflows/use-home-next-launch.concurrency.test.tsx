// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderableOutboxEntriesForTranscript } from "#product/domain/sessions/intents/session-intent-selectors";
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
import {
  EMPTY_PENDING_WORKSPACE_REGISTRY,
  upsertPendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry-registry";
import {
  MAX_CONCURRENT_PENDING_LAUNCHES,
} from "#product/lib/domain/workspaces/creation/launch-concurrency";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";
import {
  launchIntents,
} from "#product/lib/domain/chat/launch/launch-intent-registry";
import { useChatLaunchIntentStore } from "#product/stores/chat/chat-launch-intent-store";
import { useDeferredHomeLaunchStore } from "#product/stores/home/deferred-home-launch-store";
import { useHomeNextLaunch } from "#product/hooks/home/workflows/use-home-next-launch";
import type {
  HomeLaunchTarget,
  HomeNextLaunchOutcome,
} from "#product/lib/domain/home/home-next-launch";
import { CoworkThreadLaunchProvider } from "#product/providers/CoworkThreadLaunchProvider";

import {
  renderHomeNextLaunch,
  sessionIdForAttempt,
} from "#product/hooks/home/workflows/use-home-next-launch.test-support";

const mocks = vi.hoisted(() => {
  const createThreadFromSelection = vi.fn();
  return {
    createEmptySessionWithResolvedConfig: vi.fn(),
    createLocalWorkspaceAndEnterWithResult: vi.fn(),
    createSessionWithResolvedConfig: vi.fn(),
    createThreadFromSelection,
    createWorktreeAndEnterWithResult: vi.fn(),
    navigate: vi.fn(),
    productHost: { desktop: {} as object | null },
    selectWorkspace: vi.fn(),
    showToast: vi.fn(),
    showErrorToast: vi.fn(),
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
  useToastStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ show: mocks.showToast, showError: mocks.showErrorToast }),
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

// Concurrency half: several live Home launches at once — per-attempt prompt
// routing, the concurrent cap, failure scoping and announcement, and prompt
// dedupe. The single-launch routing cases live in
// `use-home-next-launch.test.tsx`; the file-size gate splits them.

describe("useHomeNextLaunch concurrent launches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.productHost.desktop = {};
    useSessionDirectoryStore.getState().clearEntries();
    useSessionTranscriptStore.getState().clearEntries();
    useSessionIntentStore.getState().clear();
    useSessionSelectionStore.getState().clearSelection();
    useChatLaunchIntentStore.setState({ intentsById: {}, intentOrder: [] });
    useDeferredHomeLaunchStore.setState({ launches: {} });
  });

  afterEach(cleanup);

  const worktreeTarget = {
    kind: "worktree" as const,
    repoRootId: "repo-root-1",
    sourceWorkspaceId: null,
    baseBranch: "main",
    defaultBranch: "main",
  };

  function pendingWorktreeEntry(attemptId: string) {
    return buildSubmittingPendingWorkspaceEntry({
      attemptId,
      selectedWorkspaceId: null,
      source: "worktree-created",
      displayName: attemptId,
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
  }

  function cloudPendingEntry(attemptId: string) {
    return buildSubmittingPendingWorkspaceEntry({
      attemptId,
      selectedWorkspaceId: null,
      source: "cloud-created",
      displayName: attemptId,
      repoLabel: "proliferate-ai/proliferate",
      baseBranchName: "main",
      request: {
        kind: "cloud",
        input: {
          gitOwner: "proliferate-ai",
          gitRepoName: "proliferate",
          baseBranch: "main",
          branchName: attemptId,
          generatedName: true,
        },
      },
    });
  }

  function registerPendingEntry(entry: ReturnType<typeof buildSubmittingPendingWorkspaceEntry>) {
    useSessionSelectionStore.setState((state) => ({
      pendingWorkspaces: upsertPendingWorkspaceEntry(state.pendingWorkspaces, entry),
    }));
  }

  it("runs two Home launches at once, each prompt routed to its own attempt (PRO-230)", async () => {
    const finishByAttemptId = new Map<string, () => void>();
    const entriesByAttemptId = new Map<
      string,
      ReturnType<typeof buildSubmittingPendingWorkspaceEntry>
    >();
    const sessionIdFor = (attemptId: string) => `client-session:codex:${attemptId}`;

    mocks.createWorktreeAndEnterWithResult.mockImplementation((_input, options) => {
      const attemptId: string = options.attemptId;
      const sessionId = sessionIdFor(attemptId);
      const entry = pendingWorktreeEntry(attemptId);
      entriesByAttemptId.set(attemptId, entry);
      putSessionRecord(createEmptySessionRecord(sessionId, "codex", {
        workspaceId: buildPendingWorkspaceUiKey(entry),
        materializedSessionId: null,
        modelId: "gpt-5.4",
      }));
      // Entering the shell moves selection onto the newest attempt, exactly as
      // a second submit does in production. The first launch must keep routing
      // to its own attempt anyway.
      useSessionSelectionStore.getState().enterPendingWorkspaceShell(entry, {
        initialActiveSessionId: sessionId,
      });
      return new Promise((resolve) => {
        finishByAttemptId.set(attemptId, () => resolve({
          workspaceId: `workspace-${attemptId}`,
          projectedSessionId: sessionId,
        }));
      });
    });

    const { result } = renderHomeNextLaunch();

    let firstLaunch: Promise<HomeNextLaunchOutcome> = Promise.resolve("refused");
    let secondLaunch: Promise<HomeNextLaunchOutcome> = Promise.resolve("refused");
    await act(async () => {
      firstLaunch = result.current.launch({
        text: "first prompt",
        modelSelection: { kind: "codex", modelId: "gpt-5.4" },
        launchControlValues: {},
        target: worktreeTarget,
      });
      await Promise.resolve();
      secondLaunch = result.current.launch({
        text: "second prompt",
        modelSelection: { kind: "codex", modelId: "gpt-5.4" },
        launchControlValues: {},
        target: worktreeTarget,
      });
      await Promise.resolve();
    });

    // Both launches are live at the same time: neither the store nor the
    // pending registry collapsed them into one.
    const liveIntents = launchIntents(useChatLaunchIntentStore.getState());
    expect(liveIntents).toHaveLength(2);
    expect(new Set(liveIntents.map((intent) => intent.text)))
      .toEqual(new Set(["first prompt", "second prompt"]));
    const attemptIds = [...finishByAttemptId.keys()];
    expect(attemptIds).toHaveLength(2);
    expect(
      useSessionSelectionStore.getState().pendingWorkspaces.attemptOrder,
    ).toEqual(attemptIds);

    let results: HomeNextLaunchOutcome[] = [];
    await act(async () => {
      for (const finish of finishByAttemptId.values()) {
        finish();
      }
      results = await Promise.all([firstLaunch, secondLaunch]);
    });

    expect(results).toEqual(["launched", "launched"]);
    const [firstAttemptId, secondAttemptId] = attemptIds as [string, string];
    expect(
      getPromptOutboxEntriesForSession(sessionIdFor(firstAttemptId))
        .map((entry) => entry.text),
    ).toEqual(["first prompt"]);
    expect(
      getPromptOutboxEntriesForSession(sessionIdFor(secondAttemptId))
        .map((entry) => entry.text),
    ).toEqual(["second prompt"]);
    expect(useChatLaunchIntentStore.getState().intentOrder).toEqual([]);
  });

  it("refuses a launch past the concurrent cap without minting an intent", async () => {
    let registry = EMPTY_PENDING_WORKSPACE_REGISTRY;
    for (let index = 0; index < MAX_CONCURRENT_PENDING_LAUNCHES; index += 1) {
      registry = upsertPendingWorkspaceEntry(registry, pendingWorktreeEntry(`attempt-${index}`));
    }
    useSessionSelectionStore.setState({ pendingWorkspaces: registry });

    const { result } = renderHomeNextLaunch();
    let outcome: HomeNextLaunchOutcome = "launched";
    await act(async () => {
      outcome = await result.current.launch({
        text: "one too many",
        modelSelection: { kind: "codex", modelId: "gpt-5.4" },
        launchControlValues: {},
        target: worktreeTarget,
      });
    });

    expect(outcome).toBe("refused");
    expect(mocks.showToast).toHaveBeenCalledWith(
      "Too many workspaces starting. Wait for one to finish.",
      "info",
    );
    expect(mocks.createWorktreeAndEnterWithResult).not.toHaveBeenCalled();
    expect(useChatLaunchIntentStore.getState().intentOrder).toEqual([]);
    expect(
      useSessionSelectionStore.getState().pendingWorkspaces.attemptOrder,
    ).toHaveLength(MAX_CONCURRENT_PENDING_LAUNCHES);
  });

  // PR #1870 review finding 1 (blocking): the cloud branch was the one launch
  // path that never learned its own attempt id, so its failure handling
  // resolved "the attended attempt" — under concurrency, another launch's. A
  // cloud failure then bound this launch's intent to the attended launch's
  // attempt and workspace, which is how one launch's failure pane surfaced over
  // another launch's shell.
  // PR #1870 review finding 5: the per-attempt notice and the launch-level
  // toast both fired for one unattended failure, the second one telling the
  // user their prompt was back in a composer they were not looking at.
  it("announces an unattended failure once, and an attended one in the shell", async () => {
    const failWhileUnattended = async (_input: unknown, options: { attemptId: string }) => {
      registerPendingEntry({
        ...pendingWorktreeEntry(options.attemptId),
        stage: "failed",
        errorMessage: "Failed to create worktree.",
      });
      throw new Error("Failed to create worktree.");
    };
    mocks.createWorktreeAndEnterWithResult.mockImplementation(failWhileUnattended);

    const { result } = renderHomeNextLaunch();
    await act(async () => {
      await result.current.launch({
        text: "fail out of sight",
        modelSelection: { kind: "codex", modelId: "gpt-5.4" },
        launchControlValues: {},
        target: worktreeTarget,
      });
    });

    // The attempt's own notice owns this one, so the launch adds nothing.
    expect(mocks.showErrorToast).not.toHaveBeenCalled();

    mocks.createWorktreeAndEnterWithResult.mockImplementation(
      async (_input: unknown, options: { attemptId: string }) => {
        const failed = {
          ...pendingWorktreeEntry(options.attemptId),
          stage: "failed" as const,
          errorMessage: "Failed to create worktree.",
        };
        registerPendingEntry(failed);
        useSessionSelectionStore.getState().enterPendingWorkspaceShell(failed, {
          initialActiveSessionId: null,
        });
        throw new Error("Failed to create worktree.");
      },
    );

    await act(async () => {
      await result.current.launch({
        text: "fail while watching",
        modelSelection: { kind: "codex", modelId: "gpt-5.4" },
        launchControlValues: {},
        target: worktreeTarget,
      });
    });

    expect(mocks.showErrorToast).toHaveBeenCalledTimes(1);
    expect(mocks.showErrorToast.mock.calls[0]?.[0].headline).toBe("Work not started");
  });

  it("collapses the same prompt submitted twice but starts two different ones", async () => {
    mocks.createWorktreeAndEnterWithResult.mockImplementation((_input, options) => {
      const attemptId: string = options.attemptId;
      const sessionId = sessionIdForAttempt(attemptId);
      const entry = pendingWorktreeEntry(attemptId);
      putSessionRecord(createEmptySessionRecord(sessionId, "codex", {
        workspaceId: buildPendingWorkspaceUiKey(entry),
        materializedSessionId: null,
        modelId: "gpt-5.4",
      }));
      useSessionSelectionStore.getState().enterPendingWorkspaceShell(entry, {
        initialActiveSessionId: sessionId,
      });
      return Promise.resolve({ workspaceId: `workspace-${attemptId}`, projectedSessionId: sessionId });
    });

    const { result } = renderHomeNextLaunch();
    const submit = (text: string, target: HomeLaunchTarget = worktreeTarget) =>
      result.current.launch({
        text,
        modelSelection: { kind: "codex" as const, modelId: "gpt-5.4" },
        launchControlValues: {},
        target,
      });

    let repeated: HomeNextLaunchOutcome = "launched";
    await act(async () => {
      await submit("ship it");
      repeated = await submit("ship it");
    });
    expect(mocks.createWorktreeAndEnterWithResult).toHaveBeenCalledTimes(1);
    // The suppressed submit is not a failure: the launch it collapsed into is
    // running, so the composer must not hand the prompt back (review finding 7).
    expect(repeated).toBe("duplicate");

    await act(async () => {
      await submit("ship something else");
    });
    expect(mocks.createWorktreeAndEnterWithResult).toHaveBeenCalledTimes(2);

    // Same prompt, different repository, inside the same second: two launches.
    await act(async () => {
      await submit("ship something else", {
        ...worktreeTarget,
        repoRootId: "repo-root-2",
      });
    });
    expect(mocks.createWorktreeAndEnterWithResult).toHaveBeenCalledTimes(3);
  });
});
