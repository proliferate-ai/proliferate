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
      workspaceSessionIds: ["selected", "visible"],
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
      workspaceSessionIds: ["selected", "queued", "running", "visible"],
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
      workspaceSessionIds: ["a", "b", "c"],
    });

    expect(targets.map((target) => target.clientSessionId)).toEqual(["c", "a"]);
  });

  it("keeps a running session in a backgrounded workspace hot", () => {
    const state = fixtures(["selected"]);
    state.directory["background-running"] = backgroundEntry("background-running", {
      status: "running",
    });
    state.directory["background-idle"] = backgroundEntry("background-idle", {
      status: "idle",
    });
    state.promptActivity["background-running"] = 0;
    state.promptActivity["background-idle"] = 0;

    const targets = resolveHotSessionTargets({
      activeSessionId: "selected",
      backgroundSessionIds: ["background-running", "background-idle"],
      directoryEntriesById: state.directory,
      promptActivityBySessionId: state.promptActivity,
      selectedWorkspaceId: "workspace-1",
      visibleChatSessionIds: ["selected"],
      workspaceSessionIds: ["selected"],
    });

    expect(targets.map((target) => [target.clientSessionId, target.reason])).toEqual([
      ["selected", "selected"],
      ["background-running", "background_running"],
    ]);
  });

  it("keeps a backgrounded session with a queued prompt hot", () => {
    const state = fixtures(["selected"]);
    state.directory["background-queued"] = backgroundEntry("background-queued", {
      status: "idle",
    });
    state.promptActivity["background-queued"] = 1;

    const targets = resolveHotSessionTargets({
      activeSessionId: "selected",
      backgroundSessionIds: ["background-queued"],
      directoryEntriesById: state.directory,
      promptActivityBySessionId: state.promptActivity,
      selectedWorkspaceId: "workspace-1",
      visibleChatSessionIds: ["selected"],
      workspaceSessionIds: ["selected"],
    });

    expect(targets.map((target) => [target.clientSessionId, target.reason])).toEqual([
      ["selected", "selected"],
      ["background-queued", "background_running"],
    ]);
  });

  it("keeps background running sessions hot with no workspace selected", () => {
    const state = fixtures([]);
    state.directory["background-running"] = backgroundEntry("background-running", {
      status: "running",
    });
    state.promptActivity["background-running"] = 0;

    const targets = resolveHotSessionTargets({
      activeSessionId: null,
      backgroundSessionIds: ["background-running"],
      directoryEntriesById: state.directory,
      promptActivityBySessionId: state.promptActivity,
      selectedWorkspaceId: null,
      visibleChatSessionIds: [],
      workspaceSessionIds: [],
    });

    expect(targets.map((target) => [target.clientSessionId, target.reason])).toEqual([
      ["background-running", "background_running"],
    ]);
  });

  it("drops background sessions before selected-workspace targets under the cap", () => {
    const state = fixtures(["selected", "visible"]);
    state.directory["background-running"] = backgroundEntry("background-running", {
      status: "running",
    });
    state.promptActivity["background-running"] = 0;

    const targets = resolveHotSessionTargets({
      activeSessionId: "selected",
      backgroundSessionIds: ["background-running"],
      directoryEntriesById: state.directory,
      maxHotSessionStreams: 2,
      promptActivityBySessionId: state.promptActivity,
      selectedWorkspaceId: "workspace-1",
      visibleChatSessionIds: ["selected", "visible"],
      workspaceSessionIds: ["selected", "visible"],
    });

    expect(targets.map((target) => target.clientSessionId)).toEqual([
      "selected",
      "visible",
    ]);
  });

  it("keeps projected targets hot but non-streamable", () => {
    const state = fixtures(["projected"], { materialized: false });

    const targets = resolveHotSessionTargets({
      activeSessionId: "projected",
      directoryEntriesById: state.directory,
      promptActivityBySessionId: state.promptActivity,
      selectedWorkspaceId: "workspace-1",
      visibleChatSessionIds: ["projected"],
      workspaceSessionIds: ["projected"],
    });

    expect(targets).toMatchObject([{
      clientSessionId: "projected",
      materializedSessionId: null,
      reason: "selected",
      streamable: false,
    }]);
  });
});

function backgroundEntry(
  sessionId: string,
  options: { status: HotSessionDirectoryEntry["status"] },
): HotSessionDirectoryEntry {
  return {
    materializedSessionId: sessionId,
    workspaceId: "workspace-2",
    status: options.status,
    executionSummary: null,
    streamConnectionState: "disconnected",
    activity: {
      isStreaming: false,
      pendingInteractions: [],
    },
  };
}

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
