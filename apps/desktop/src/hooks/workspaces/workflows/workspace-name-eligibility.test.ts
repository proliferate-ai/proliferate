import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspace-model";
import type { WorkspaceSessionCacheSnapshot } from "@/hooks/access/anyharness/sessions/use-workspace-session-cache";

const mocks = vi.hoisted(() => ({
  getMaterializedSessionId: vi.fn(),
  getWorkspaceSessionRecords: vi.fn(),
}));

vi.mock("@/stores/sessions/session-records", () => ({
  getMaterializedSessionId: mocks.getMaterializedSessionId,
  getWorkspaceSessionRecords: mocks.getWorkspaceSessionRecords,
}));

import {
  workspaceDisplayNameOverride,
  workspaceHasOtherPromptedSession,
} from "@/hooks/workspaces/workflows/workspace-name-eligibility";

function makeLogicalWorkspace(overrides: Partial<LogicalWorkspace>): LogicalWorkspace {
  return {
    id: "logical-1",
    repoKey: "repo",
    sourceRoot: "/src",
    repoRoot: null,
    provider: null,
    owner: null,
    repoName: null,
    branchKey: "branch",
    displayName: "Branch Fallback Label",
    localWorkspace: null,
    cloudWorkspace: null,
    preferredMaterializationId: null,
    effectiveOwner: "local",
    lifecycle: "local_active",
    updatedAt: "2026-06-12T00:00:00Z",
    ...overrides,
  };
}

function snapshot(sessions: WorkspaceSessionCacheSnapshot["sessions"]): WorkspaceSessionCacheSnapshot {
  return { sessions, dataUpdatedAt: 0, isInvalidated: false };
}

describe("workspaceDisplayNameOverride", () => {
  it("returns null when neither materialization has an override", () => {
    const workspace = makeLogicalWorkspace({
      localWorkspace: { displayName: "  " } as LogicalWorkspace["localWorkspace"],
    });
    expect(workspaceDisplayNameOverride(workspace)).toBeNull();
  });

  it("ignores the computed displayName label and reads the local override", () => {
    const workspace = makeLogicalWorkspace({
      displayName: "Branch Fallback Label",
      localWorkspace: { displayName: "My Workspace" } as LogicalWorkspace["localWorkspace"],
    });
    expect(workspaceDisplayNameOverride(workspace)).toBe("My Workspace");
  });

  it("falls back to the cloud override when there is no local materialization", () => {
    const workspace = makeLogicalWorkspace({
      cloudWorkspace: { displayName: "Cloud Name" } as LogicalWorkspace["cloudWorkspace"],
    });
    expect(workspaceDisplayNameOverride(workspace)).toBe("Cloud Name");
  });
});

describe("workspaceHasOtherPromptedSession", () => {
  const getWorkspaceSessionCacheSnapshot = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMaterializedSessionId.mockReturnValue("session-1");
    mocks.getWorkspaceSessionRecords.mockReturnValue({});
    getWorkspaceSessionCacheSnapshot.mockReturnValue(snapshot([]));
  });

  it("returns false when only the triggering session exists", () => {
    mocks.getWorkspaceSessionRecords.mockReturnValue({
      "client-session-1": { materializedSessionId: "session-1", hasAttemptedPrompt: true },
    });
    getWorkspaceSessionCacheSnapshot.mockReturnValue(
      snapshot([{ id: "session-1", lastPromptAt: "2026-06-12T00:00:00Z" } as never]),
    );

    expect(
      workspaceHasOtherPromptedSession({
        workspaceId: "workspace-1",
        clientSessionId: "client-session-1",
        getWorkspaceSessionCacheSnapshot,
      }),
    ).toBe(false);
  });

  it("returns true when another directory session has been prompted", () => {
    mocks.getWorkspaceSessionRecords.mockReturnValue({
      "client-session-1": { materializedSessionId: "session-1", hasAttemptedPrompt: true },
      "client-session-2": { materializedSessionId: "session-2", lastPromptAt: "2026-06-12T00:00:00Z" },
    });

    expect(
      workspaceHasOtherPromptedSession({
        workspaceId: "workspace-1",
        clientSessionId: "client-session-1",
        getWorkspaceSessionCacheSnapshot,
      }),
    ).toBe(true);
  });

  it("returns true when a historical cached session was prompted", () => {
    getWorkspaceSessionCacheSnapshot.mockReturnValue(
      snapshot([
        { id: "session-1", lastPromptAt: "2026-06-12T00:00:00Z" } as never,
        { id: "session-old", lastPromptAt: "2026-06-11T00:00:00Z" } as never,
      ]),
    );

    expect(
      workspaceHasOtherPromptedSession({
        workspaceId: "workspace-1",
        clientSessionId: "client-session-1",
        getWorkspaceSessionCacheSnapshot,
      }),
    ).toBe(true);
  });
});
