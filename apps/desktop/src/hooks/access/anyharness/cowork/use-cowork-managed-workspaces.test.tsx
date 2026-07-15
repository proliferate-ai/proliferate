// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEmptySessionRecord,
  putSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";
import {
  beginEmptySessionReplacement,
  type EmptySessionReplacementTransaction,
} from "@/hooks/sessions/workflows/use-empty-session-replacement-cleanup";
import {
  resetReplacedSessionTombstonesForTests,
} from "@/hooks/sessions/workflows/session-replacement-tombstones";
import { useCoworkManagedWorkspaces } from "./use-cowork-managed-workspaces";

const mocks = vi.hoisted(() => ({
  useCoworkManagedWorkspacesQuery: vi.fn(() => ({
    data: undefined,
    isLoading: false,
  })),
}));

vi.mock("@anyharness/sdk-react", () => ({
  useCoworkManagedWorkspacesQuery: mocks.useCoworkManagedWorkspacesQuery,
  useDismissSessionMutation: vi.fn(),
}));

beforeEach(() => {
  mocks.useCoworkManagedWorkspacesQuery.mockClear();
  useSessionDirectoryStore.getState().clearEntries();
  useSessionTranscriptStore.getState().clearEntries();
  resetReplacedSessionTombstonesForTests();
  putSessionRecord(createEmptySessionRecord("runtime-old", "codex", {
    workspaceId: "workspace-1",
    materializedSessionId: "runtime-old",
    modelId: "gpt-5",
  }));
});

afterEach(() => {
  cleanup();
  resetReplacedSessionTombstonesForTests();
});

describe("useCoworkManagedWorkspaces replacement lifecycle", () => {
  it("does not query a staged replacement and re-enables after rollback", () => {
    renderHook(() => useCoworkManagedWorkspaces("runtime-old", true));
    expect(mocks.useCoworkManagedWorkspacesQuery).toHaveBeenLastCalledWith(
      "runtime-old",
      { enabled: true },
    );

    let transaction: EmptySessionReplacementTransaction | null = null;
    act(() => {
      transaction = beginEmptySessionReplacement("runtime-old", "workspace-1", {
        closeSessionSlotStream: vi.fn(),
        removeWorkspaceSessionRecord: vi.fn(),
        dismissSessionMutation: { mutateAsync: vi.fn() } as never,
        captureException: vi.fn(),
      });
    });

    expect(transaction).not.toBeNull();
    expect(mocks.useCoworkManagedWorkspacesQuery).toHaveBeenLastCalledWith(
      "runtime-old",
      { enabled: false },
    );

    act(() => {
      transaction?.rollback();
    });

    expect(mocks.useCoworkManagedWorkspacesQuery).toHaveBeenLastCalledWith(
      "runtime-old",
      { enabled: true },
    );
  });
});
