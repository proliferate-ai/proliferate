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
  useWorkspacePinIntentReconciliation,
} from "#product/hooks/sessions/lifecycle/use-workspace-pin-intent-reconciliation";

const projection = vi.hoisted(() => ({
  isLoading: true,
  logicalWorkspaces: [] as LogicalWorkspace[],
}));

vi.mock("#product/hooks/workspaces/derived/use-logical-workspaces", () => ({
  useLogicalWorkspaces: () => projection,
}));

describe("useWorkspacePinIntentReconciliation", () => {
  beforeEach(() => {
    projection.isLoading = true;
    projection.logicalWorkspaces = [];
    useWorkspaceUiStore.setState({
      ...WORKSPACE_UI_DEFAULTS,
      _hydrated: false,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("retains a runtime intent until workspace projection and preferences are ready", async () => {
    const envelope = pinIntent();
    const rendered = renderHook(() => useWorkspacePinIntentReconciliation());

    act(() => {
      rendered.result.current([envelope]);
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
      rendered.result.current([envelope]);
    });
    expect(useWorkspaceUiStore.getState().pinnedWorkspaceIds).toEqual([]);
  });

  it("retains an unresolved intent after loading until the workspace appears", async () => {
    projection.isLoading = false;
    useWorkspaceUiStore.setState({ _hydrated: true });
    const rendered = renderHook(() => useWorkspacePinIntentReconciliation());

    act(() => {
      rendered.result.current([pinIntent()]);
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
});

function pinIntent(): SessionEventEnvelope {
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
      pinned: true,
    },
  };
}
