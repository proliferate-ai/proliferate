import { describe, expect, it } from "vitest";
import type {
  PlanImplementationHarnessState,
  PlanImplementationSessionRecord,
} from "./implementation-target";
import {
  resolvePlanImplementationReadiness,
  resolvePlanImplementationTargetCheck,
} from "./implementation-target";

describe("resolvePlanImplementationReadiness", () => {
  it("blocks when the source session is missing", () => {
    expect(resolvePlanImplementationReadiness({
      plan: planTarget(),
      harnessState: {
        activeSessionId: "session-1",
        sessionRecords: {},
      },
      isChatDisabled: false,
      chatDisabledReason: null,
    })).toEqual({
      status: "blocked",
      message: "Plan session is not available.",
    });
  });

  it("blocks when the source session is not active", () => {
    expect(resolvePlanImplementationReadiness({
      plan: planTarget(),
      harnessState: state({ activeSessionId: "session-2" }),
      isChatDisabled: false,
      chatDisabledReason: null,
    })).toEqual({
      status: "blocked",
      message: "Select the plan's session before carrying it out.",
    });
  });

  it("blocks when the source workspace is missing", () => {
    expect(resolvePlanImplementationReadiness({
      plan: planTarget(),
      harnessState: state({ workspaceId: null }),
      isChatDisabled: false,
      chatDisabledReason: null,
    })).toEqual({
      status: "blocked",
      message: "Select a workspace before implementing a plan.",
    });
  });

  it("blocks with the chat disabled reason when chat is unavailable", () => {
    expect(resolvePlanImplementationReadiness({
      plan: planTarget(),
      harnessState: state(),
      isChatDisabled: true,
      chatDisabledReason: "Session is busy.",
    })).toEqual({
      status: "blocked",
      message: "Session is busy.",
    });
  });

  it("returns the target session, workspace, and agent when ready", () => {
    const harnessState = state();

    expect(resolvePlanImplementationReadiness({
      plan: planTarget(),
      harnessState,
      isChatDisabled: false,
      chatDisabledReason: null,
    })).toEqual({
      status: "ready",
      session: harnessState.sessionRecords["session-1"],
      workspaceId: "workspace-1",
      agentKind: "codex",
    });
  });
});

describe("resolvePlanImplementationTargetCheck", () => {
  it("blocks when the active target changed after setup", () => {
    expect(resolvePlanImplementationTargetCheck({
      plan: planTarget(),
      harnessState: state({ activeSessionId: "session-2" }),
      expectedWorkspaceId: "workspace-1",
    })).toEqual({
      status: "blocked",
      message: "Select the plan's session before carrying it out.",
    });
  });

  it("blocks when the session workspace changed after setup", () => {
    expect(resolvePlanImplementationTargetCheck({
      plan: planTarget(),
      harnessState: state({ workspaceId: "workspace-2" }),
      expectedWorkspaceId: "workspace-1",
    })).toEqual({
      status: "blocked",
      message: "Select the plan's session before carrying it out.",
    });
  });

  it("returns ready when the active session and workspace still match", () => {
    expect(resolvePlanImplementationTargetCheck({
      plan: planTarget(),
      harnessState: state(),
      expectedWorkspaceId: "workspace-1",
    })).toEqual({ status: "ready" });
  });
});

function planTarget() {
  return { sourceSessionId: "session-1" };
}

function state(input: {
  activeSessionId?: string;
  workspaceId?: string | null;
  agentKind?: string | null;
} = {}): PlanImplementationHarnessState {
  return {
    activeSessionId: input.activeSessionId ?? "session-1",
    sessionRecords: {
      "session-1": sessionRecord(input),
    },
  };
}

function sessionRecord(input: {
  workspaceId?: string | null;
  agentKind?: string | null;
} = {}): PlanImplementationSessionRecord {
  return {
    workspaceId: input.workspaceId === undefined ? "workspace-1" : input.workspaceId,
    agentKind: input.agentKind ?? "codex",
    liveConfig: {
      normalizedControls: {
        collaborationMode: null,
        mode: null,
      },
    },
  };
}
