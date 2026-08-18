// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { SessionEventEnvelope } from "@anyharness/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LogicalWorkspace } from "#product/lib/domain/workspaces/cloud/logical-workspace-model";
import {
  makeLocalLogicalWorkspace,
} from "#product/lib/domain/workspaces/sidebar/sidebar-test-fixtures";
import { WORKSPACE_UI_DEFAULTS } from "#product/lib/domain/preferences/workspace-ui/model";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import {
  useWorkspacePinIntentReconciliationLifecycle,
} from "#product/hooks/sessions/lifecycle/use-workspace-pin-intent-reconciliation";
import {
  dispatchWorkspacePinIntentEnvelopes,
  resetWorkspacePinIntentDispatchForTests,
} from "#product/hooks/sessions/lifecycle/workspace-pin-intent-dispatch";
import { resetWorkspacePinLocalOrderForTests } from "#product/stores/preferences/workspace-ui-pin-local-order";

const projection = vi.hoisted(() => ({
  isLoading: true,
  logicalWorkspaces: [] as LogicalWorkspace[],
}));

vi.mock("#product/hooks/workspaces/derived/use-logical-workspaces", () => ({
  useLogicalWorkspaces: () => projection,
}));

describe("useWorkspacePinIntentReconciliation", () => {
  beforeEach(() => {
    resetWorkspacePinIntentDispatchForTests();
    resetWorkspacePinLocalOrderForTests();
    projection.isLoading = true;
    projection.logicalWorkspaces = [];
    useWorkspaceUiStore.setState({
      ...WORKSPACE_UI_DEFAULTS,
      _hydrated: false,
      workspacePinHistoryObservationById: {},
    });
  });

  afterEach(() => {
    cleanup();
    resetWorkspacePinIntentDispatchForTests();
  });

  it("retains a runtime intent until workspace projection and preferences are ready", async () => {
    const envelope = pinIntent();
    const rendered = renderHook(() => useWorkspacePinIntentReconciliationLifecycle());

    act(() => {
      dispatchWorkspacePinIntentEnvelopes([envelope], "live");
    });
    expect(useWorkspaceUiStore.getState().pinnedWorkspaceIds).toEqual([]);

    const workspace = makeLocalLogicalWorkspace({
      id: "logical-workspace",
      repoKey: "/tmp/repo",
      repoName: "repo",
    });
    workspace.aliasIds = ["workspace-1"];
    projection.logicalWorkspaces = [workspace];
    projection.isLoading = false;
    rendered.rerender();
    expect(useWorkspaceUiStore.getState().pinnedWorkspaceIds).toEqual([]);

    act(() => {
      useWorkspaceUiStore.setState({ _hydrated: true });
    });
    await waitFor(() => {
      expect(useWorkspaceUiStore.getState().pinnedWorkspaceIds).toEqual([
        "logical-workspace",
      ]);
    });

    act(() => {
      useWorkspaceUiStore.getState().unpinWorkspace(["logical-workspace"]);
      dispatchWorkspacePinIntentEnvelopes([envelope], "live");
    });
    expect(useWorkspaceUiStore.getState().pinnedWorkspaceIds).toEqual([]);
  });

  it("retains an unresolved intent after loading until the workspace appears", async () => {
    projection.isLoading = false;
    useWorkspaceUiStore.setState({ _hydrated: true });
    const rendered = renderHook(() => useWorkspacePinIntentReconciliationLifecycle());

    act(() => {
      dispatchWorkspacePinIntentEnvelopes([pinIntent()], "history");
    });
    expect(useWorkspaceUiStore.getState().pinnedWorkspaceIds).toEqual([]);

    const workspace = makeLocalLogicalWorkspace({
      id: "logical-workspace",
      repoKey: "/tmp/repo",
      repoName: "repo",
    });
    workspace.aliasIds = ["workspace-1"];
    projection.logicalWorkspaces = [workspace];
    rendered.rerender();

    await waitFor(() => {
      expect(useWorkspaceUiStore.getState().pinnedWorkspaceIds).toEqual([
        "logical-workspace",
      ]);
    });
  });

  it("keeps a later manual choice when a first-seen history intent arrives", () => {
    projection.logicalWorkspaces = [logicalWorkspace()];
    projection.isLoading = false;
    useWorkspaceUiStore.setState({
      _hydrated: true,
      pinnedWorkspaceIds: ["logical-workspace"],
    });
    renderHook(() => useWorkspacePinIntentReconciliationLifecycle());

    act(() => {
      useWorkspaceUiStore.getState().unpinWorkspace(["logical-workspace", "workspace-1"]);
      dispatchWorkspacePinIntentEnvelopes([pinIntent()], "history");
    });

    expect(useWorkspaceUiStore.getState().pinnedWorkspaceIds).toEqual([]);
    expect(Object.keys(useWorkspaceUiStore.getState().workspacePinIntentReceiptByTarget))
      .toHaveLength(1);
  });

  it("keeps a manual choice made after a live intent was observed but before it resolved", async () => {
    projection.isLoading = false;
    useWorkspaceUiStore.setState({ _hydrated: true });
    const rendered = renderHook(() => useWorkspacePinIntentReconciliationLifecycle());

    act(() => {
      dispatchWorkspacePinIntentEnvelopes([pinIntent()], "live");
      useWorkspaceUiStore.getState().unpinWorkspace(["logical-workspace", "workspace-1"]);
    });
    projection.logicalWorkspaces = [logicalWorkspace()];
    rendered.rerender();

    await waitFor(() => {
      expect(Object.keys(useWorkspaceUiStore.getState().workspacePinIntentReceiptByTarget))
        .toHaveLength(1);
    });
    expect(useWorkspaceUiStore.getState().pinnedWorkspaceIds).toEqual([]);
  });

  it("applies a newly observed live intent after a manual choice", () => {
    projection.logicalWorkspaces = [logicalWorkspace()];
    projection.isLoading = false;
    useWorkspaceUiStore.setState({ _hydrated: true });
    renderHook(() => useWorkspacePinIntentReconciliationLifecycle());

    act(() => {
      useWorkspaceUiStore.getState().unpinWorkspace(["logical-workspace", "workspace-1"]);
      dispatchWorkspacePinIntentEnvelopes([pinIntent()], "live");
    });

    expect(useWorkspaceUiStore.getState().pinnedWorkspaceIds).toEqual(["logical-workspace"]);
  });

  it("does not let older cross-session history overwrite later history after alias resolution", async () => {
    projection.logicalWorkspaces = [logicalWorkspace(["workspace-newer"])];
    projection.isLoading = false;
    useWorkspaceUiStore.setState({
      _hydrated: true,
      pinnedWorkspaceIds: ["logical-workspace"],
    });
    const rendered = renderHook(() => useWorkspacePinIntentReconciliationLifecycle());

    act(() => {
      dispatchWorkspacePinIntentEnvelopes([pinIntent({
        sessionId: "session-a",
        requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        workspaceId: "workspace-older",
        pinned: true,
        seq: 1,
      })], "history");
      dispatchWorkspacePinIntentEnvelopes([pinIntent({
        sessionId: "session-b",
        requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        workspaceId: "workspace-newer",
        pinned: false,
        seq: 1,
      })], "history");
    });

    expect(useWorkspaceUiStore.getState().pinnedWorkspaceIds).toEqual([]);
    expect(Object.keys(useWorkspaceUiStore.getState().workspacePinIntentReceiptByTarget))
      .toHaveLength(1);

    projection.logicalWorkspaces = [
      logicalWorkspace(["workspace-newer", "workspace-older"]),
    ];
    rendered.rerender();

    await waitFor(() => {
      expect(Object.keys(useWorkspaceUiStore.getState().workspacePinIntentReceiptByTarget))
        .toHaveLength(2);
    });
    expect(useWorkspaceUiStore.getState().pinnedWorkspaceIds).toEqual([]);
  });

  it("keeps history provenance when a live duplicate arrives before resolution", async () => {
    projection.isLoading = false;
    useWorkspaceUiStore.setState({
      _hydrated: true,
      pinnedWorkspaceIds: ["logical-workspace"],
    });
    const rendered = renderHook(() => useWorkspacePinIntentReconciliationLifecycle());

    act(() => {
      dispatchWorkspacePinIntentEnvelopes([pinIntent()], "history");
      useWorkspaceUiStore.getState().unpinWorkspace(["logical-workspace", "workspace-1"]);
      dispatchWorkspacePinIntentEnvelopes([pinIntent()], "live");
    });
    projection.logicalWorkspaces = [logicalWorkspace()];
    rendered.rerender();

    await waitFor(() => {
      expect(Object.keys(useWorkspaceUiStore.getState().workspacePinIntentReceiptByTarget))
        .toHaveLength(1);
    });
    expect(useWorkspaceUiStore.getState().pinnedWorkspaceIds).toEqual([]);
  });

  it("keeps live provenance when a history duplicate arrives before resolution", async () => {
    projection.isLoading = false;
    useWorkspaceUiStore.setState({
      _hydrated: true,
      pinnedWorkspaceIds: ["logical-workspace"],
    });
    const rendered = renderHook(() => useWorkspacePinIntentReconciliationLifecycle());

    act(() => {
      useWorkspaceUiStore.getState().unpinWorkspace(["logical-workspace", "workspace-1"]);
      dispatchWorkspacePinIntentEnvelopes([pinIntent()], "live");
      dispatchWorkspacePinIntentEnvelopes([pinIntent()], "history");
    });
    projection.logicalWorkspaces = [logicalWorkspace()];
    rendered.rerender();

    await waitFor(() => {
      expect(useWorkspaceUiStore.getState().pinnedWorkspaceIds).toEqual(["logical-workspace"]);
    });
  });
});

function logicalWorkspace(aliasIds: string[] = ["workspace-1"]): LogicalWorkspace {
  const workspace = makeLocalLogicalWorkspace({
    id: "logical-workspace",
    repoKey: "/tmp/repo",
    repoName: "repo",
  });
  workspace.aliasIds = aliasIds;
  return workspace;
}

function pinIntent(args: {
  sessionId?: string;
  requestId?: string;
  workspaceId?: string;
  pinned?: boolean;
  seq?: number;
} = {}): SessionEventEnvelope {
  const sessionId = args.sessionId ?? "session-1";
  return {
    sessionId,
    seq: args.seq ?? 2,
    timestamp: "2026-08-17T00:00:02Z",
    event: {
      type: "workspace_pin_intent",
      requestId: args.requestId ?? "11111111-1111-4111-8111-111111111111",
      runtimeId: "runtime-1",
      sourceSessionId: sessionId,
      workspaceId: args.workspaceId ?? "workspace-1",
      pinned: args.pinned ?? true,
    },
  };
}
