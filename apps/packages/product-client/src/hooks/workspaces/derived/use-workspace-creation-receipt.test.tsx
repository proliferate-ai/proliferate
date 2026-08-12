// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session, Workspace } from "@anyharness/sdk";
import {
  AnyHarnessRuntime,
  AnyHarnessWorkspace,
  anyHarnessSessionsKey,
} from "@anyharness/sdk-react";
import { buildWorkspaceArrivalEvent } from "#product/lib/domain/workspaces/creation/arrival";
import {
  createEmptySessionRecord,
  patchSessionRecord,
  putSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";
import { useWorkspaceCreationReceiptKey } from "#product/hooks/workspaces/derived/use-workspace-creation-receipt";

const WORKSPACE_ID = "workspace-1";
const CACHE_SCOPE_KEY = "runtime:test";
const FIRST_CLIENT_SESSION_ID = "client-session:first";
const FIRST_RUNTIME_SESSION_ID = "runtime-session:first";
const SECOND_CLIENT_SESSION_ID = "client-session:second";
const SECOND_RUNTIME_SESSION_ID = "runtime-session:second";

const mocks = vi.hoisted(() => ({
  workspace: null as Workspace | null,
}));

vi.mock("#product/hooks/workspaces/cache/use-workspaces", () => ({
  useWorkspaces: () => ({
    data: mocks.workspace
      ? {
        workspaces: [mocks.workspace],
        repoRoots: [],
      }
      : undefined,
  }),
}));

describe("useWorkspaceCreationReceiptKey", () => {
  beforeEach(() => {
    mocks.workspace = makeWorkspace();
    useSessionDirectoryStore.getState().clearEntries();
    useSessionTranscriptStore.getState().clearEntries();
    useSessionSelectionStore.setState({
      pendingWorkspaceEntry: null,
      selectedLogicalWorkspaceId: WORKSPACE_ID,
      selectedWorkspaceId: WORKSPACE_ID,
      workspaceSelectionNonce: 1,
      workspaceArrivalEvent: buildWorkspaceArrivalEvent({
        workspaceId: WORKSPACE_ID,
        source: "worktree-created",
        receiptClientSessionId: FIRST_CLIENT_SESSION_ID,
      }),
      workspaceSessionRecovery: null,
      activeSessionId: FIRST_CLIENT_SESSION_ID,
      activeSessionVersion: 1,
      sessionActivationIntentEpochByWorkspace: {},
      hotPaintGate: null,
    });
    putSessionRecord(createEmptySessionRecord(FIRST_CLIENT_SESSION_ID, "codex", {
      workspaceId: WORKSPACE_ID,
      materializedSessionId: FIRST_RUNTIME_SESSION_ID,
    }));
    putSessionRecord(createEmptySessionRecord(SECOND_CLIENT_SESSION_ID, "codex", {
      workspaceId: WORKSPACE_ID,
      materializedSessionId: SECOND_RUNTIME_SESSION_ID,
    }));
  });

  afterEach(() => {
    cleanup();
    mocks.workspace = null;
    useSessionDirectoryStore.getState().clearEntries();
    useSessionTranscriptStore.getState().clearEntries();
  });

  it("keeps a live worktree receipt on its first session when switching tabs", () => {
    const queryClient = createQueryClient([
      // AnyHarness lists by updatedAt descending. Creation ownership must use
      // createdAt instead of trusting this transport order.
      makeSession({
        id: SECOND_RUNTIME_SESSION_ID,
        createdAt: "2026-08-11T12:01:00.000Z",
        updatedAt: "2026-08-11T12:03:00.000Z",
      }),
      makeSession({
        id: FIRST_RUNTIME_SESSION_ID,
        createdAt: "2026-08-11T12:00:00.000Z",
        updatedAt: "2026-08-11T12:02:00.000Z",
      }),
    ]);
    const { result } = renderReceiptKey(queryClient);

    expect(result.current).toBe(WORKSPACE_ID);

    act(() => {
      useSessionSelectionStore.getState().activateHotSession({
        sessionId: SECOND_CLIENT_SESSION_ID,
      });
    });

    expect(result.current).toBeNull();
    expect(useSessionSelectionStore.getState().workspaceArrivalEvent?.workspaceId)
      .toBe(WORKSPACE_ID);

    act(() => {
      useSessionSelectionStore.getState().activateHotSession({
        sessionId: FIRST_CLIENT_SESSION_ID,
      });
    });

    expect(result.current).toBe(WORKSPACE_ID);
  });

  it("bridges only the owning projected session until server identity arrives", () => {
    patchSessionRecord(FIRST_CLIENT_SESSION_ID, { materializedSessionId: null });
    useSessionSelectionStore.setState({
      hotPaintGate: {
        workspaceId: WORKSPACE_ID,
        sessionId: FIRST_CLIENT_SESSION_ID,
        nonce: 1,
        operationId: null,
        kind: "workspace_hot_reopen",
      },
    });
    const queryClient = createQueryClient();
    const { result } = renderReceiptKey(queryClient);

    // The owner alias is available before the runtime session and its list
    // query exist, so the pending receipt never flashes back to Thinking.
    expect(result.current).toBe(WORKSPACE_ID);

    act(() => {
      useSessionSelectionStore.getState().activateHotSession({
        sessionId: SECOND_CLIENT_SESSION_ID,
      });
    });
    expect(result.current).toBeNull();

    act(() => {
      useSessionSelectionStore.getState().activateHotSession({
        sessionId: FIRST_CLIENT_SESSION_ID,
      });
    });
    expect(result.current).toBe(WORKSPACE_ID);

    act(() => {
      patchSessionRecord(FIRST_CLIENT_SESSION_ID, {
        materializedSessionId: FIRST_RUNTIME_SESSION_ID,
      });
      queryClient.setQueryData(
        anyHarnessSessionsKey(CACHE_SCOPE_KEY, WORKSPACE_ID),
        [makeSession({
          id: FIRST_RUNTIME_SESSION_ID,
          createdAt: "2026-08-11T12:00:00.000Z",
          updatedAt: "2026-08-11T12:02:00.000Z",
        })],
      );
      useSessionSelectionStore.setState({ hotPaintGate: null });
    });

    expect(result.current).toBe(WORKSPACE_ID);
  });
});

function createQueryClient(sessions?: Session[]): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  });
  if (sessions) {
    queryClient.setQueryData(
      anyHarnessSessionsKey(CACHE_SCOPE_KEY, WORKSPACE_ID),
      sessions,
    );
  }
  return queryClient;
}

function renderReceiptKey(queryClient: QueryClient) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <AnyHarnessRuntime
        runtimeUrl="http://runtime.test"
        cacheScopeKey={CACHE_SCOPE_KEY}
      >
        <AnyHarnessWorkspace
          workspaceId={WORKSPACE_ID}
          resolveConnection={async () => ({
            runtimeUrl: "http://runtime.test",
            anyharnessWorkspaceId: WORKSPACE_ID,
          })}
        >
          {children}
        </AnyHarnessWorkspace>
      </AnyHarnessRuntime>
    </QueryClientProvider>
  );
  return renderHook(() => useWorkspaceCreationReceiptKey(), { wrapper });
}

function makeWorkspace(): Workspace {
  return {
    availability: "available",
    cleanupState: "none",
    createdAt: "2026-08-11T11:59:00.000Z",
    id: WORKSPACE_ID,
    kind: "worktree",
    lifecycleState: "active",
    path: "/repo/worktrees/feature",
    repoRootId: "repo-root-1",
    surface: "standard",
    updatedAt: "2026-08-11T12:00:00.000Z",
  };
}

function makeSession(overrides: Pick<Session, "id" | "createdAt" | "updatedAt">): Session {
  return {
    actionCapabilities: { fork: false, targetedFork: false },
    agentKind: "codex",
    status: "idle",
    workspaceId: WORKSPACE_ID,
    ...overrides,
  };
}
