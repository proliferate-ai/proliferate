import { describe, expect, it } from "vitest";
import {
  createDefaultAnonymousTelemetryPersistedState,
  deriveAnonymousTelemetryDirectives,
} from "./anonymous-events";

describe("createDefaultAnonymousTelemetryPersistedState", () => {
  it("starts with empty milestone and usage state", () => {
    expect(createDefaultAnonymousTelemetryPersistedState()).toEqual({
      schemaVersion: 1,
      sentMilestones: [],
      pendingMilestones: [],
      usageCounters: {
        sessionsStarted: 0,
        promptsSubmitted: 0,
        workspacesCreatedLocal: 0,
        workspacesCreatedCloud: 0,
        credentialsSynced: 0,
        connectorsInstalled: 0,
      },
      lastUsageFlushedAt: null,
    });
  });
});

describe("deriveAnonymousTelemetryDirectives", () => {
  it("maps chat session creation into a usage increment", () => {
    expect(
      deriveAnonymousTelemetryDirectives("chat_session_created", {
        agent_kind: "claude",
        workspace_kind: "local",
      }),
    ).toEqual([{ kind: "increment_usage", counter: "sessionsStarted" }]);
  });

  it("maps prompt submission into both activation and usage", () => {
    expect(
      deriveAnonymousTelemetryDirectives("chat_prompt_submitted", {
        agent_kind: "claude",
        reuse_session: false,
        workspace_kind: "local",
      }),
    ).toEqual([
      { kind: "mark_activation", milestone: "first_prompt_submitted" },
      { kind: "increment_usage", counter: "promptsSubmitted" },
    ]);
  });

  it("maps local workspace creation into the local workspace counters", () => {
    expect(
      deriveAnonymousTelemetryDirectives("workspace_created", {
        creation_kind: "worktree",
        workspace_kind: "local",
        setup_script_status: "succeeded",
      }),
    ).toEqual([
      { kind: "mark_activation", milestone: "first_local_workspace_created" },
      { kind: "increment_usage", counter: "workspacesCreatedLocal" },
    ]);
  });

  it("ignores product events that are not part of anonymous telemetry v1", () => {
    expect(
      deriveAnonymousTelemetryDirectives("auth_signed_in", {
        provider: "github",
        source: "interactive_poll",
      }),
    ).toEqual([]);
  });
});
