// @vitest-environment jsdom

import { type ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ProductHost } from "@proliferate/product-client/host/product-host";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
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
} from "@/hooks/sessions/workflows/session-replacement-tombstone-durable-operations";
import {
  beginSessionReplacementTombstoneHydration,
  settleSessionReplacementTombstoneHydration,
} from "@/hooks/sessions/workflows/session-replacement-tombstone-authority";
import { useCoworkManagedWorkspaces } from "./use-cowork-managed-workspaces";

const storage = {
  getItem: vi.fn(async () => null),
  setItem: vi.fn(async () => {}),
  removeItem: vi.fn(async () => {}),
};
const host = {
  storage,
  telemetry: { captureException: vi.fn() },
} as unknown as ProductHost;
const persistence = {
  storage,
  captureException: host.telemetry.captureException,
};

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
  beginSessionReplacementTombstoneHydration(storage);
  settleSessionReplacementTombstoneHydration(false);
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
    renderHook(() => useCoworkManagedWorkspaces("runtime-old", true), {
      wrapper: ProductHostTestWrapper,
    });
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
        persistence,
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

function ProductHostTestWrapper({ children }: { children: ReactNode }) {
  return <ProductHostProvider host={host}>{children}</ProductHostProvider>;
}
