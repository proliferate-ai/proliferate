// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEmptySessionRecord,
  putSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";
import {
  beginEmptySessionReplacement,
  type EmptySessionReplacementTransaction,
} from "#product/hooks/sessions/workflows/use-empty-session-replacement-cleanup";
import {
  resetReplacedSessionTombstonesForTests,
} from "#product/hooks/sessions/workflows/session-replacement-tombstones";
import { useCoworkManagedWorkspaces } from "#product/hooks/access/anyharness/cowork/use-cowork-managed-workspaces";

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
