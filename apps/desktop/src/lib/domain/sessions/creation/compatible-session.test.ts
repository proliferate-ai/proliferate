import { describe, expect, it } from "vitest";
import type { Session } from "@anyharness/sdk";
import {
  findCompatibleExistingSession,
  shouldProbeCompatibleRuntimeSessions,
} from "@/lib/domain/sessions/creation/compatible-session";

function session(overrides: Partial<Session>): Session {
  return {
    id: "session-1",
    workspaceId: "workspace-1",
    agentKind: "codex",
    modelId: "gpt-5.4",
    status: "idle",
    createdAt: "2026-04-28T00:00:00.000Z",
    updatedAt: "2026-04-28T00:00:00.000Z",
    ...overrides,
  } as Session;
}

describe("findCompatibleExistingSession", () => {
  it("matches sessions with the requested agent and model", () => {
    const matched = session({ id: "match", modelId: "gpt-5.5" });

    expect(findCompatibleExistingSession({
      sessions: [
        session({ id: "wrong-agent", agentKind: "claude", modelId: "gpt-5.5" }),
        matched,
      ],
      agentKind: "codex",
      modelId: "gpt-5.5",
    })).toBe(matched);
  });

  it("treats missing model ids as compatible", () => {
    const matched = session({ id: "match", modelId: null });

    expect(findCompatibleExistingSession({
      sessions: [matched],
      agentKind: "codex",
      modelId: "gpt-5.5",
    })).toBe(matched);
  });

  it("matches against requested model ids when current model ids lag behind", () => {
    const matched = session({
      id: "match",
      modelId: "sonnet",
      requestedModelId: "opus",
    });

    expect(findCompatibleExistingSession({
      sessions: [matched],
      agentKind: "codex",
      modelId: "opus",
    })).toBe(matched);
  });

  it("does not match a stale current model when requested model differs", () => {
    expect(findCompatibleExistingSession({
      sessions: [
        session({
          id: "wrong-requested-model",
          modelId: "opus",
          requestedModelId: "sonnet",
        }),
      ],
      agentKind: "codex",
      modelId: "opus",
    })).toBeNull();
  });

  it("returns null when no session matches", () => {
    expect(findCompatibleExistingSession({
      sessions: [session({ id: "wrong-model", modelId: "gpt-5.4" })],
      agentKind: "codex",
      modelId: "gpt-5.5",
    })).toBeNull();
  });
});

describe("shouldProbeCompatibleRuntimeSessions", () => {
  it("allows direct runtime reuse for local and target workspaces", () => {
    expect(shouldProbeCompatibleRuntimeSessions({
      preferExistingCompatibleSession: true,
      runtimeLocation: "local",
    })).toBe(true);
    expect(shouldProbeCompatibleRuntimeSessions({
      preferExistingCompatibleSession: true,
      runtimeLocation: "target",
    })).toBe(true);
  });

  it("does not reuse direct cloud runtime sessions that may not be projected", () => {
    expect(shouldProbeCompatibleRuntimeSessions({
      preferExistingCompatibleSession: true,
      runtimeLocation: "cloud",
    })).toBe(false);
  });

  it("respects callers that did not request compatible-session probing", () => {
    expect(shouldProbeCompatibleRuntimeSessions({
      preferExistingCompatibleSession: false,
      runtimeLocation: "local",
    })).toBe(false);
  });
});
