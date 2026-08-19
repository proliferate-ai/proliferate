// @vitest-environment jsdom

import type { WorkflowRunDocV2 } from "@anyharness/sdk";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkflowDocOpen } from "#product/hooks/workflows/ui/use-workflow-doc-open";
import { fileViewerTarget } from "#product/lib/domain/workspaces/viewer/viewer-target";

const mocks = vi.hoisted(() => ({
  activateViewerTarget: vi.fn(),
  openTarget: vi.fn(),
}));

vi.mock("#product/hooks/workspaces/workflows/tabs/use-workspace-shell-activation", () => ({
  useWorkspaceShellActivation: () => ({
    activateViewerTarget: mocks.activateViewerTarget,
  }),
}));

vi.mock("#product/stores/editor/workspace-viewer-tabs-store", () => ({
  useWorkspaceViewerTabsStore: (
    selector: (state: { openTarget: typeof mocks.openTarget }) => unknown,
  ) => selector({ openTarget: mocks.openTarget }),
}));

vi.mock("#product/stores/sessions/session-selection-store", () => ({
  useSessionSelectionStore: (
    selector: (state: { selectedLogicalWorkspaceId: string }) => unknown,
  ) => selector({ selectedLogicalWorkspaceId: "logical-workspace-1" }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useWorkflowDocOpen", () => {
  it("opens and activates the exact run-scoped context-doc path", () => {
    const doc: WorkflowRunDocV2 = {
      id: "doc-1",
      runId: "run-1",
      slug: "research-findings",
      filename: "03-research-findings.md",
      producingNodeRowId: "node-1",
      seededFromTemplate: false,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    };
    const scopedTarget = fileViewerTarget(
      ".proliferate/context/run-1/03-research-findings.md",
    );
    const flatTarget = fileViewerTarget(".proliferate/context/03-research-findings.md");
    const { result } = renderHook(() => useWorkflowDocOpen("workspace-1"));

    act(() => result.current(doc));

    expect(mocks.openTarget).toHaveBeenCalledWith(scopedTarget);
    expect(mocks.openTarget).not.toHaveBeenCalledWith(flatTarget);
    expect(mocks.activateViewerTarget).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      shellWorkspaceId: "logical-workspace-1",
      target: scopedTarget,
      mode: "open-or-focus",
    });
  });
});
