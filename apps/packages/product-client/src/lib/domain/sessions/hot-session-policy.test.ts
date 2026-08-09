import { describe, expect, it } from "vitest";
import {
  type ResolveHotSessionTargetsInput,
  resolveHotSessionTargets,
} from "#product/lib/domain/sessions/hot-session-policy";

type HotSessionDirectoryEntry = NonNullable<
  ResolveHotSessionTargetsInput["directoryEntriesById"][string]
>;

describe("resolveHotSessionTargets", () => {
  it("includes visible unselected tabs in the selected workspace", () => {
    const state = fixtures(["selected", "visible"]);

    const targets = resolveHotSessionTargets({
      activeSessionId: "selected",
      directoryEntriesById: state.directory,
      promptActivityBySessionId: state.promptActivity,
      selectedWorkspaceId: "workspace-1",
      visibleChatSessionIds: ["selected", "visible"],
      candidateSessionIds: ["selected", "visible"],
    });

    expect(targets.map((target) => [target.clientSessionId, target.reason])).toEqual([
      ["selected", "selected"],
      ["visible", "open_tab"],
    ]);
  });

  it("promotes queued prompts above running and open tabs", () => {
    const state = fixtures(["selected", "queued", "running", "visible"]);
    state.promptActivity.queued = 1;
    state.directory.running = {
      ...state.directory.running!,
      status: "running",
    };

    const targets = resolveHotSessionTargets({
      activeSessionId: "selected",
      directoryEntriesById: state.directory,
      promptActivityBySessionId: state.promptActivity,
      selectedWorkspaceId: "workspace-1",
      visibleChatSessionIds: ["selected", "queued", "running", "visible"],
      candidateSessionIds: ["selected", "queued", "running", "visible"],
    });

    expect(targets.map((target) => [target.clientSessionId, target.reason])).toEqual([
      ["selected", "selected"],
      ["queued", "queued_prompt"],
      ["running", "running"],
      ["visible", "open_tab"],
    ]);
  });

  it("keeps selected sessions inside a small cap", () => {
    const state = fixtures(["a", "b", "c"]);

    const targets = resolveHotSessionTargets({
      activeSessionId: "c",
      directoryEntriesById: state.directory,
      maxHotSessionStreams: 2,
      promptActivityBySessionId: state.promptActivity,
      selectedWorkspaceId: "workspace-1",
      visibleChatSessionIds: ["a", "b", "c"],
      candidateSessionIds: ["a", "b", "c"],
    });

    expect(targets.map((target) => target.clientSessionId)).toEqual(["c", "a"]);
  });

  it("keeps projected targets hot but non-streamable", () => {
    const state = fixtures(["projected"], { materialized: false });

    const targets = resolveHotSessionTargets({
      activeSessionId: "projected",
      directoryEntriesById: state.directory,
      promptActivityBySessionId: state.promptActivity,
      selectedWorkspaceId: "workspace-1",
      visibleChatSessionIds: ["projected"],
      candidateSessionIds: ["projected"],
    });

    expect(targets).toMatchObject([{
      clientSessionId: "projected",
      materializedSessionId: null,
      reason: "selected",
      streamable: false,
    }]);
  });

  it("keeps a running session hot while another workspace is selected", () => {
    const state = fixtures(["selected", "background"]);
    state.directory.background = {
      ...state.directory.background!,
      workspaceId: "workspace-2",
      streamConnectionState: "open",
      activity: {
        ...state.directory.background!.activity,
        isStreaming: true,
      },
    };

    const targets = resolveHotSessionTargets({
      activeSessionId: "selected",
      candidateSessionIds: ["selected", "background"],
      directoryEntriesById: state.directory,
      promptActivityBySessionId: state.promptActivity,
      selectedWorkspaceId: "workspace-1",
      visibleChatSessionIds: ["selected"],
    });

    expect(targets.map((target) => [target.clientSessionId, target.reason])).toEqual([
      ["selected", "selected"],
      ["background", "running"],
    ]);
  });

  it("keeps only active background work hot when no workspace is selected", () => {
    const state = fixtures(["running", "idle"]);
    state.directory.running = {
      ...state.directory.running!,
      workspaceId: "workspace-2",
      streamConnectionState: "open",
      activity: {
        ...state.directory.running!.activity,
        isStreaming: true,
      },
    };
    state.directory.idle = {
      ...state.directory.idle!,
      workspaceId: "workspace-3",
    };

    const targets = resolveHotSessionTargets({
      activeSessionId: null,
      candidateSessionIds: ["running", "idle"],
      directoryEntriesById: state.directory,
      promptActivityBySessionId: state.promptActivity,
      selectedWorkspaceId: null,
      visibleChatSessionIds: [],
    });

    expect(targets.map((target) => [target.clientSessionId, target.reason])).toEqual([
      ["running", "running"],
    ]);
  });
});

function fixtures(
  sessionIds: string[],
  options?: { materialized?: boolean },
): {
  directory: Record<string, HotSessionDirectoryEntry>;
  promptActivity: Record<string, number>;
} {
  const directory: Record<string, HotSessionDirectoryEntry> = {};
  const promptActivity: Record<string, number> = {};
  for (const sessionId of sessionIds) {
    directory[sessionId] = {
      materializedSessionId: options?.materialized === false ? null : sessionId,
      workspaceId: "workspace-1",
      status: "idle",
      executionSummary: null,
      streamConnectionState: "disconnected",
      activity: {
        isStreaming: false,
        pendingInteractions: [],
      },
    };
    promptActivity[sessionId] = 0;
  }
  return { directory, promptActivity };
}
