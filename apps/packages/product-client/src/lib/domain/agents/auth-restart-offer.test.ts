import { describe, expect, it } from "vitest";
import type { AgentAuthSelection } from "@proliferate/cloud-sdk";
import {
  authAppliedTransitions,
  authScopeKey,
  isRunningSessionEntry,
  matchRunningSessions,
  pendingAuthScopeKeys,
  restartSessionLabel,
  sessionAuthSurface,
} from "#product/lib/domain/agents/auth-restart-offer";
import {
  createDirectoryEntry,
  type DirectoryEntryInput,
} from "#product/lib/domain/sessions/directory/directory-entry";

function selection(
  overrides: Partial<AgentAuthSelection> & Pick<AgentAuthSelection, "harnessKind" | "surface">,
): AgentAuthSelection {
  return {
    id: `${overrides.harnessKind}:${overrides.surface}:${overrides.sourceKind ?? "gateway"}`,
    sourceKind: "gateway",
    apiKeyId: null,
    keyTitle: null,
    envVarName: null,
    providerHint: null,
    enabled: true,
    createdAt: "2026-07-27T00:00:00Z",
    updatedAt: "2026-07-27T00:00:00Z",
    ...overrides,
  };
}

function entry(input: Partial<DirectoryEntryInput> & { sessionId: string }) {
  return createDirectoryEntry({
    agentKind: "claude",
    workspaceId: "ws-local-1",
    status: "running",
    ...input,
  });
}

describe("pendingAuthScopeKeys", () => {
  it("marks a scope pending only on an explicit applied:false", () => {
    const keys = pendingAuthScopeKeys([
      selection({ harnessKind: "claude", surface: "local", applied: false }),
      selection({ harnessKind: "claude", surface: "cloud", applied: true }),
      // Schema-optional: absent applied reads as applied, never pending.
      selection({ harnessKind: "codex", surface: "local" }),
      selection({ harnessKind: "opencode", surface: "local", applied: null }),
    ]);
    expect([...keys]).toEqual(["claude:local"]);
  });
});

describe("authAppliedTransitions", () => {
  it("reports a scope that flipped pending to applied", () => {
    const before = new Set([authScopeKey({ harnessKind: "claude", surface: "local" })]);
    const transitions = authAppliedTransitions(before, [
      selection({ harnessKind: "claude", surface: "local", applied: true }),
      selection({ harnessKind: "codex", surface: "local", applied: true }),
    ]);
    expect(transitions).toEqual([{ harnessKind: "claude", surface: "local" }]);
  });

  it("does not report a scope that is still pending", () => {
    const before = new Set([authScopeKey({ harnessKind: "claude", surface: "local" })]);
    expect(
      authAppliedTransitions(before, [
        selection({ harnessKind: "claude", surface: "local", applied: false }),
      ]),
    ).toEqual([]);
  });

  it("does not report a scope whose records disappeared (no ack to observe)", () => {
    const before = new Set([authScopeKey({ harnessKind: "claude", surface: "local" })]);
    expect(
      authAppliedTransitions(before, [
        selection({ harnessKind: "codex", surface: "local", applied: true }),
      ]),
    ).toEqual([]);
  });

  it("keeps pending scopes on the two surfaces independent", () => {
    const before = new Set([
      authScopeKey({ harnessKind: "claude", surface: "local" }),
      authScopeKey({ harnessKind: "claude", surface: "cloud" }),
    ]);
    const transitions = authAppliedTransitions(before, [
      selection({ harnessKind: "claude", surface: "local", applied: true }),
      selection({ harnessKind: "claude", surface: "cloud", applied: false }),
    ]);
    expect(transitions).toEqual([{ harnessKind: "claude", surface: "local" }]);
  });
});

describe("sessionAuthSurface", () => {
  it("maps plain workspace ids to the local surface", () => {
    expect(sessionAuthSurface("ws-1")).toBe("local");
  });

  it("maps cloud synthetic ids to the cloud surface", () => {
    expect(sessionAuthSurface("cloud:cw-1")).toBe("cloud");
  });

  it("maps a missing workspace to no auth surface", () => {
    expect(sessionAuthSurface(null)).toBeNull();
  });
});

describe("isRunningSessionEntry", () => {
  it.each([
    ["running status", { status: "running" } as const, true],
    ["starting status", { status: "starting" } as const, true],
    ["idle status", { status: "idle" } as const, false],
    ["completed status", { status: "completed" } as const, false],
    ["errored status", { status: "errored" } as const, false],
  ])("classifies %s", (_name, patch, expected) => {
    expect(isRunningSessionEntry(entry({ sessionId: "s", ...patch }))).toBe(expected);
  });

  it("treats an awaiting_interaction phase as running", () => {
    const awaiting = entry({
      sessionId: "s",
      status: "idle",
      executionSummary: {
        hasLiveHandle: true,
        phase: "awaiting_interaction",
        updatedAt: "2026-07-27T00:00:00Z",
      },
    });
    expect(isRunningSessionEntry(awaiting)).toBe(true);
  });
});

describe("matchRunningSessions (Proof C6 scoping)", () => {
  it("lists exactly the running sessions of the switched harness on the switched surface", () => {
    const entries = [
      entry({ sessionId: "match-1", agentKind: "claude", workspaceId: "ws-1" }),
      entry({ sessionId: "match-2", agentKind: "claude", workspaceId: "ws-2" }),
      // Wrong harness.
      entry({ sessionId: "other-harness", agentKind: "codex", workspaceId: "ws-1" }),
      // Wrong surface (cloud workspace on a local switch).
      entry({ sessionId: "other-surface", agentKind: "claude", workspaceId: "cloud:cw-1" }),
      // Not running.
      entry({ sessionId: "idle", agentKind: "claude", workspaceId: "ws-1", status: "idle" }),
    ];
    const matched = matchRunningSessions(entries, { harnessKind: "claude", surface: "local" });
    expect(matched.map((item) => item.sessionId)).toEqual(["match-1", "match-2"]);
  });

  it("scopes a cloud switch to cloud-sandbox sessions only", () => {
    const entries = [
      entry({ sessionId: "cloud-1", agentKind: "claude", workspaceId: "cloud:cw-1" }),
      entry({ sessionId: "local-1", agentKind: "claude", workspaceId: "ws-1" }),
    ];
    const matched = matchRunningSessions(entries, { harnessKind: "claude", surface: "cloud" });
    expect(matched.map((item) => item.sessionId)).toEqual(["cloud-1"]);
  });
});

describe("restartSessionLabel", () => {
  it("prefers the session title, then the transcript title, then the id", () => {
    expect(restartSessionLabel(entry({ sessionId: "s", title: "Fix the build" })))
      .toBe("Fix the build");
    expect(
      restartSessionLabel(
        entry({ sessionId: "s", activity: { transcriptTitle: "Investigating" } }),
      ),
    ).toBe("Investigating");
    expect(restartSessionLabel(entry({ sessionId: "s-42" }))).toBe("s-42");
  });
});
