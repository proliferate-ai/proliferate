import type { SessionEventEnvelope } from "@anyharness/sdk";
import { describe, expect, it } from "vitest";
import {
  resolveWorkspacePinIntent,
  workspacePinIntentForEnvelope,
} from "#product/lib/domain/workspaces/sidebar/workspace-pin-intents";
import {
  makeLocalLogicalWorkspace,
} from "#product/lib/domain/workspaces/sidebar/sidebar-test-fixtures";

describe("workspacePinIntentForEnvelope", () => {
  it.each([
    [true],
    [false],
  ] as const)("accepts a correlated runtime-owned pin intent (%s)", (pinned) => {
    expect(workspacePinIntentForEnvelope(pinIntent(pinned))).toEqual({
      requestId: "11111111-1111-4111-8111-111111111111",
      runtimeId: "runtime-1",
      sessionId: "session-1",
      seq: 2,
      workspaceId: "workspace-1",
      pinned,
    });
  });

  it("rejects transcript tool output, replay remapping, and malformed runtime events", () => {
    const transcriptOutput = {
      ...pinIntent(true),
      itemId: "tool-1",
      event: { type: "item_completed", item: {} },
    } as unknown as SessionEventEnvelope;
    expect(workspacePinIntentForEnvelope(transcriptOutput)).toBeNull();

    const replayed = pinIntent(true);
    replayed.sessionId = "replay-session";
    expect(workspacePinIntentForEnvelope(replayed)).toBeNull();

    const malformed = pinIntent(true) as unknown as {
      event: { requestId: string; workspaceId: string };
    };
    malformed.event.requestId = "not-a-runtime-request-id";
    expect(workspacePinIntentForEnvelope(malformed as unknown as SessionEventEnvelope)).toBeNull();

    const itemScoped = { ...pinIntent(true), itemId: "tool-1" };
    expect(workspacePinIntentForEnvelope(itemScoped)).toBeNull();
  });
});

describe("resolveWorkspacePinIntent", () => {
  it("uses the logical id for pinning and every related id for unpinning", () => {
    const workspace = makeLocalLogicalWorkspace({
      id: "logical-workspace",
      repoKey: "/tmp/repo",
      repoName: "repo",
    });
    workspace.aliasIds = ["workspace-1"];

    expect(resolveWorkspacePinIntent({
      runtimeId: "runtime-1",
      sessionId: "session-1",
      requestId: "11111111-1111-4111-8111-111111111111",
      seq: 2,
      workspaceId: "workspace-1",
      pinned: false,
    }, [workspace])).toMatchObject({
      pinId: "logical-workspace",
      relatedIds: expect.arrayContaining(["logical-workspace", "workspace-1"]),
    });
  });

  it("rejects a workspace that is not in the local logical projection", () => {
    expect(resolveWorkspacePinIntent({
      requestId: "11111111-1111-4111-8111-111111111111",
      runtimeId: "runtime-1",
      sessionId: "session-1",
      seq: 2,
      workspaceId: "remote-workspace",
      pinned: true,
    }, [])).toBeNull();
  });
});

function pinIntent(pinned: boolean): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq: 2,
    timestamp: "2026-08-17T00:00:02Z",
    event: {
      type: "workspace_pin_intent",
      requestId: "11111111-1111-4111-8111-111111111111",
      runtimeId: "runtime-1",
      sourceSessionId: "session-1",
      workspaceId: "workspace-1",
      pinned,
    },
  };
}
