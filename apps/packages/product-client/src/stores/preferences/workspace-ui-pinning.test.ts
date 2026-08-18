import { afterEach, describe, expect, it } from "vitest";
import {
  WORKSPACE_PIN_HISTORY_OBSERVATION_LIMIT,
  WORKSPACE_PIN_INTENT_RECEIPT_LIMIT,
  WORKSPACE_PIN_LOCAL_BARRIER_LIMIT,
  WORKSPACE_UI_DEFAULTS,
} from "#product/lib/domain/preferences/workspace-ui/model";
import type { ResolvedWorkspacePinIntent } from "#product/lib/domain/workspaces/sidebar/workspace-pin-intents";
import { resetWorkspacePinLocalOrderForTests } from "#product/stores/preferences/workspace-ui-pin-local-order";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";

afterEach(() => {
  resetWorkspacePinLocalOrderForTests();
  useWorkspaceUiStore.setState({ workspacePinHistoryObservationById: {} });
});

describe("workspace ui pinning", () => {
  it("pins and unpins workspaces in pin order", () => {
    useWorkspaceUiStore.setState({
      ...WORKSPACE_UI_DEFAULTS,
      _hydrated: true,
    });

    const store = useWorkspaceUiStore.getState();
    store.pinWorkspace("ws-1");
    store.pinWorkspace("ws-2");
    store.pinWorkspace("ws-1");

    expect(useWorkspaceUiStore.getState().pinnedWorkspaceIds).toEqual(["ws-1", "ws-2"]);

    // Unpin clears every id the workspace answers to, including pins recorded
    // under a former identity, and ignores ids that were never pinned.
    useWorkspaceUiStore.getState().unpinWorkspace(["ws-1", "ws-1-former-alias"]);
    useWorkspaceUiStore.getState().unpinWorkspace(["ws-missing"]);

    expect(useWorkspaceUiStore.getState().pinnedWorkspaceIds).toEqual(["ws-2"]);
  });

  it("applies Workspace MCP pin intents once per target and tolerates delayed targets", () => {
    useWorkspaceUiStore.setState({
      ...WORKSPACE_UI_DEFAULTS,
      _hydrated: true,
      pinnedWorkspaceIds: ["ws-existing-alias"],
    });

    useWorkspaceUiStore.getState().applyWorkspacePinIntentBatch([
      {
        requestId: "request-new",
        observedAt: localOrder(3),
        provenance: "live",
        runtimeId: "runtime-1",
        sessionId: "session-1",
        seq: 3,
        pinId: "ws-new",
        relatedIds: ["ws-new"],
        pinned: true,
      },
      {
        requestId: "request-existing",
        observedAt: localOrder(4),
        provenance: "live",
        runtimeId: "runtime-1",
        sessionId: "session-1",
        seq: 4,
        pinId: "ws-existing",
        relatedIds: ["ws-existing", "ws-existing-alias"],
        pinned: false,
      },
    ]);

    expect(useWorkspaceUiStore.getState().pinnedWorkspaceIds).toEqual(["ws-new"]);
    expect(useWorkspaceUiStore.getState().workspacePinIntentReceiptByTarget).toEqual({
      [workspacePinIntentTargetKey("runtime-1", "session-1", "ws-new")]: {
        requestId: "request-new",
        seq: 3,
      },
      [workspacePinIntentTargetKey("runtime-1", "session-1", "ws-existing")]: {
        requestId: "request-existing",
        seq: 4,
      },
    });

    useWorkspaceUiStore.getState().unpinWorkspace(["ws-new"]);
    useWorkspaceUiStore.getState().applyWorkspacePinIntentBatch([{
      requestId: "request-new",
      observedAt: localOrder(5),
      provenance: "live",
      runtimeId: "runtime-1",
      sessionId: "session-1",
      seq: 3,
      pinId: "ws-new",
      relatedIds: ["ws-new"],
      pinned: true,
    }]);
    expect(useWorkspaceUiStore.getState().pinnedWorkspaceIds).toEqual([]);

    useWorkspaceUiStore.getState().applyWorkspacePinIntentBatch([{
      requestId: "request-delayed",
      observedAt: localOrder(6),
      provenance: "live",
      runtimeId: "runtime-1",
      sessionId: "session-1",
      seq: 2,
      pinId: "ws-delayed",
      relatedIds: ["ws-delayed"],
      pinned: true,
    }]);
    expect(useWorkspaceUiStore.getState().pinnedWorkspaceIds).toEqual(["ws-delayed"]);

    useWorkspaceUiStore.getState().applyWorkspacePinIntentBatch([{
      requestId: "request-stale",
      observedAt: localOrder(7),
      provenance: "live",
      runtimeId: "runtime-1",
      sessionId: "session-1",
      seq: 1,
      pinId: "ws-delayed",
      relatedIds: ["ws-delayed"],
      pinned: false,
    }]);
    expect(useWorkspaceUiStore.getState().pinnedWorkspaceIds).toEqual(["ws-delayed"]);
  });

  it("preserves same-target observation order across session-local sequences", () => {
    useWorkspaceUiStore.setState({
      ...WORKSPACE_UI_DEFAULTS,
      _hydrated: true,
    });

    useWorkspaceUiStore.getState().applyWorkspacePinIntentBatch([
      {
        requestId: "request-observed-first",
        observedAt: localOrder(1),
        provenance: "live",
        runtimeId: "runtime-1",
        sessionId: "session-high-seq",
        seq: 100,
        pinId: "workspace-shared",
        relatedIds: ["workspace-shared"],
        pinned: true,
      },
      {
        requestId: "request-observed-second",
        observedAt: localOrder(2),
        provenance: "live",
        runtimeId: "runtime-1",
        sessionId: "session-low-seq",
        seq: 1,
        pinId: "workspace-shared",
        relatedIds: ["workspace-shared"],
        pinned: false,
      },
    ]);

    expect(useWorkspaceUiStore.getState().pinnedWorkspaceIds).toEqual([]);

    useWorkspaceUiStore.getState().applyWorkspacePinIntentBatch([{
      requestId: "request-resolved-late",
      observedAt: localOrder(1),
      provenance: "live",
      runtimeId: "runtime-1",
      sessionId: "session-resolved-late",
      seq: 50,
      pinId: "workspace-shared",
      relatedIds: ["workspace-shared"],
      pinned: true,
    }]);
    expect(useWorkspaceUiStore.getState().pinnedWorkspaceIds).toEqual([]);
  });

  it("receipts delayed older history without overwriting later cross-session history", () => {
    useWorkspaceUiStore.setState({
      ...WORKSPACE_UI_DEFAULTS,
      _hydrated: true,
      pinnedWorkspaceIds: ["workspace-shared"],
      workspacePinHistoryObservationById: {},
    });

    useWorkspaceUiStore.getState().applyWorkspacePinIntentBatch([
      historyIntent({
        requestId: "request-observed-later",
        observedSequence: 2,
        sessionId: "session-b",
        pinned: false,
      }),
    ]);
    useWorkspaceUiStore.getState().applyWorkspacePinIntentBatch([
      historyIntent({
        requestId: "request-resolved-late",
        observedSequence: 1,
        sessionId: "session-a",
        pinned: true,
      }),
    ]);

    const state = useWorkspaceUiStore.getState();
    expect(state.pinnedWorkspaceIds).toEqual([]);
    expect(Object.keys(state.workspacePinIntentReceiptByTarget)).toHaveLength(2);
    expect(state.workspacePinHistoryObservationById["workspace-shared"])
      .toEqual(localOrder(2));
  });

  it("records current-renderer history order even when the receipt is a duplicate", () => {
    const targetKey = workspacePinIntentTargetKey(
      "runtime-1",
      "session-b",
      "workspace-shared",
    );
    useWorkspaceUiStore.setState({
      ...WORKSPACE_UI_DEFAULTS,
      _hydrated: true,
      workspacePinIntentReceiptByTarget: {
        [targetKey]: { requestId: "request-existing", seq: 1 },
      },
      workspacePinHistoryObservationById: {},
    });

    useWorkspaceUiStore.getState().applyWorkspacePinIntentBatch([
      historyIntent({
        requestId: "request-existing",
        observedSequence: 4,
        sessionId: "session-b",
        pinned: false,
      }),
    ]);

    const state = useWorkspaceUiStore.getState();
    expect(state.workspacePinIntentReceiptByTarget[targetKey])
      .toEqual({ requestId: "request-existing", seq: 1 });
    expect(state.workspacePinHistoryObservationById["workspace-shared"])
      .toEqual(localOrder(4));
  });

  it("accepts a new-renderer live observation after a persisted prior-renderer barrier", () => {
    useWorkspaceUiStore.setState({
      ...WORKSPACE_UI_DEFAULTS,
      _hydrated: true,
      workspacePinLocalBarrierById: {
        "workspace-shared": localOrder(999, "renderer-prior"),
      },
    });

    useWorkspaceUiStore.getState().applyWorkspacePinIntentBatch([{
      requestId: "request-after-reload",
      observedAt: localOrder(1, "renderer-current"),
      provenance: "live",
      runtimeId: "runtime-1",
      sessionId: "session-current",
      seq: 1,
      pinId: "workspace-shared",
      relatedIds: ["workspace-shared"],
      pinned: true,
    }]);

    expect(useWorkspaceUiStore.getState().pinnedWorkspaceIds).toEqual(["workspace-shared"]);
  });

  it("bounds persisted Workspace MCP pin receipts by most-recent target", () => {
    useWorkspaceUiStore.setState({
      ...WORKSPACE_UI_DEFAULTS,
      _hydrated: true,
    });

    useWorkspaceUiStore.getState().applyWorkspacePinIntentBatch(
      Array.from({ length: WORKSPACE_PIN_INTENT_RECEIPT_LIMIT + 2 }, (_, index) => ({
        requestId: `request-${index}`,
        observedAt: localOrder(index + 1),
        provenance: "live" as const,
        runtimeId: "runtime-1",
        sessionId: `session-${index}`,
        seq: index + 1,
        pinId: `workspace-${index}`,
        relatedIds: [`workspace-${index}`],
        pinned: false,
      })),
    );

    const receipts = useWorkspaceUiStore.getState().workspacePinIntentReceiptByTarget;
    expect(Object.keys(receipts)).toHaveLength(WORKSPACE_PIN_INTENT_RECEIPT_LIMIT);
    expect(receipts[workspacePinIntentTargetKey("runtime-1", "session-0", "workspace-0")])
      .toBeUndefined();
    expect(receipts[
      workspacePinIntentTargetKey("runtime-1", "session-257", "workspace-257")
    ]).toEqual({ requestId: "request-257", seq: 258 });
  });

  it("bounds local pin barriers by most-recent addressed workspace", () => {
    useWorkspaceUiStore.setState({
      ...WORKSPACE_UI_DEFAULTS,
      _hydrated: true,
    });

    for (let index = 0; index < WORKSPACE_PIN_LOCAL_BARRIER_LIMIT + 2; index += 1) {
      useWorkspaceUiStore.getState().unpinWorkspace([`workspace-${index}`]);
    }

    const barriers = useWorkspaceUiStore.getState().workspacePinLocalBarrierById;
    expect(Object.keys(barriers)).toHaveLength(WORKSPACE_PIN_LOCAL_BARRIER_LIMIT);
    expect(barriers["workspace-0"]).toBeUndefined();
    expect(barriers["workspace-257"]).toEqual({
      rendererEpoch: expect.any(String),
      sequence: WORKSPACE_PIN_LOCAL_BARRIER_LIMIT + 2,
    });
  });

  it("bounds current-renderer history observations by most-recent workspace", () => {
    useWorkspaceUiStore.setState({
      ...WORKSPACE_UI_DEFAULTS,
      _hydrated: true,
      workspacePinHistoryObservationById: {},
    });

    useWorkspaceUiStore.getState().applyWorkspacePinIntentBatch(
      Array.from({ length: WORKSPACE_PIN_HISTORY_OBSERVATION_LIMIT + 2 }, (_, index) =>
        historyIntent({
          requestId: `request-${index}`,
          observedSequence: index + 1,
          sessionId: `session-${index}`,
          pinId: `workspace-${index}`,
          pinned: false,
        })),
    );

    const observations = useWorkspaceUiStore.getState().workspacePinHistoryObservationById;
    expect(Object.keys(observations)).toHaveLength(WORKSPACE_PIN_HISTORY_OBSERVATION_LIMIT);
    expect(observations["workspace-0"]).toBeUndefined();
    expect(observations["workspace-257"]).toEqual(localOrder(258));
  });

  it("clears current-renderer history order on hydration so new offline history can apply", () => {
    useWorkspaceUiStore.setState({
      workspacePinHistoryObservationById: {
        "workspace-shared": localOrder(10),
      },
    });

    useWorkspaceUiStore.getState().hydrate(WORKSPACE_UI_DEFAULTS);

    expect(useWorkspaceUiStore.getState().workspacePinHistoryObservationById).toEqual({});

    useWorkspaceUiStore.getState().applyWorkspacePinIntentBatch([
      historyIntent({
        requestId: "request-after-hydrate",
        observedSequence: 1,
        sessionId: "session-current",
        pinned: true,
      }),
    ]);

    expect(useWorkspaceUiStore.getState().pinnedWorkspaceIds).toEqual(["workspace-shared"]);
  });
});

function workspacePinIntentTargetKey(
  runtimeId: string,
  sessionId: string,
  pinId: string,
): string {
  return JSON.stringify([runtimeId, sessionId, pinId]);
}

function localOrder(sequence: number, rendererEpoch = "renderer-current") {
  return { rendererEpoch, sequence };
}

function historyIntent(args: {
  requestId: string;
  observedSequence: number;
  sessionId: string;
  pinned: boolean;
  pinId?: string;
}): ResolvedWorkspacePinIntent {
  const pinId = args.pinId ?? "workspace-shared";
  return {
    requestId: args.requestId,
    observedAt: localOrder(args.observedSequence),
    provenance: "history",
    runtimeId: "runtime-1",
    sessionId: args.sessionId,
    seq: 1,
    pinId,
    relatedIds: [pinId],
    pinned: args.pinned,
  };
}
