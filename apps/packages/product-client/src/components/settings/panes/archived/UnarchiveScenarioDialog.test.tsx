// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { UnarchiveScenarioDialog } from "#product/components/settings/panes/archived/UnarchiveScenarioDialog";
import type { UnarchiveScenarioState } from "#product/hooks/workspaces/workflows/use-workspace-archive-actions";

// Radix Dialog (ModalShell) touches DOM APIs jsdom doesn't implement.
beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function baseState(overrides: Partial<UnarchiveScenarioState> = {}): UnarchiveScenarioState {
  return {
    workspaceId: "w1",
    workspaceName: "my-workspace",
    scenario: "branch_diverged",
    occupantName: null,
    occupantLifecycle: null,
    strategies: ["recreate_at_sha", "restore_detached"],
    ...overrides,
  };
}

describe("UnarchiveScenarioDialog", () => {
  it("renders nothing when state is null", () => {
    const { container } = render(
      <UnarchiveScenarioDialog state={null} onCancel={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders exactly the payload's strategies and nothing else", () => {
    render(
      <UnarchiveScenarioDialog state={baseState()} onCancel={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(screen.getByText("Recreate at the archived commit")).not.toBeNull();
    expect(screen.getByText("Restore detached")).not.toBeNull();
    expect(screen.queryByText("Restore at the branch's current tip")).toBeNull();
    expect(screen.queryByText("Overwrite")).toBeNull();
  });

  it("posts the selected branchStrategy on confirm", () => {
    const onConfirm = vi.fn();
    render(
      <UnarchiveScenarioDialog state={baseState()} onCancel={vi.fn()} onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByText("Restore detached"));
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(onConfirm).toHaveBeenCalledWith("w1", { branchStrategy: "restore_detached" });
  });

  it("path_occupied with a live occupant renders informational copy with no overwrite button", () => {
    render(
      <UnarchiveScenarioDialog
        state={baseState({
          scenario: "path_occupied",
          occupantName: "other-workspace",
          occupantLifecycle: "active",
          strategies: [],
        })}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByText(/belongs to other-workspace.*archive it first/i)).not.toBeNull();
    expect(screen.queryByRole("button", { name: /overwrite/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /restore/i })).toBeNull();
  });

  it("path_occupied with an archived occupant names the unarchive-or-delete exit", () => {
    render(
      <UnarchiveScenarioDialog
        state={baseState({
          scenario: "path_occupied",
          occupantName: "other-workspace",
          occupantLifecycle: "archived",
          strategies: [],
        })}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByText(/unarchive or delete that workspace first/i)).not.toBeNull();
  });

  it("path_occupied against an unclaimed directory offers a destructive Overwrite that posts overwrite: true", () => {
    const onConfirm = vi.fn();
    render(
      <UnarchiveScenarioDialog
        state={baseState({
          scenario: "path_occupied",
          occupantName: null,
          occupantLifecycle: null,
          strategies: ["overwrite"],
        })}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    const overwriteButton = screen.getByRole("button", { name: "Overwrite" });
    fireEvent.click(overwriteButton);
    expect(onConfirm).toHaveBeenCalledWith("w1", { overwrite: true });
  });

  it("cancel calls onCancel and posts nothing", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <UnarchiveScenarioDialog state={baseState()} onCancel={onCancel} onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
