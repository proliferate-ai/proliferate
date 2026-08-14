// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  AGENTS_PANE_GROUP_ORDER,
  agentsPaneActions,
  agentsPaneGroupLabel,
  type AgentsPaneChild,
  type AgentsPaneGroupKey,
  type AgentsPaneModel,
  type AgentsPaneParent,
} from "#product/lib/domain/delegated-work/agents-pane-model";
import { AgentsPaneOverview } from "./AgentsPaneOverview";
import { AgentsPaneParentCluster } from "./AgentsPaneParentCluster";

const WORKSPACE_ID = "workspace-agents-pane-test";

function child(
  sessionId: string,
  title: string,
  group: AgentsPaneGroupKey,
  detailLabel: string,
  hasLiveActor = group === "running",
): AgentsPaneChild {
  return {
    sessionId,
    sessionLinkId: `link-${sessionId}`,
    title,
    group,
    detailLabel,
    hasLiveActor,
    actions: agentsPaneActions(group),
  };
}

function parent(
  sessionId: string,
  title: string,
  children: readonly AgentsPaneChild[],
): AgentsPaneParent {
  return {
    sessionId,
    title,
    children,
    groups: AGENTS_PANE_GROUP_ORDER.map((key) => ({
      key,
      label: agentsPaneGroupLabel(key),
      children: children.filter((entry) => entry.group === key),
    })),
    closedOnly:
      children.length > 0 && children.every((entry) => entry.group === "closed"),
  };
}

const activeParent = parent("session-parent-active", "Feature build", [
  child("session-run-1", "Explore dotfiles", "running", "Working"),
  child("session-avail-1", "Draft spec", "available", "Available", false),
  child("session-avail-2", "Broken probe", "available", "Failed", false),
  child("session-closed-1", "Old sweep", "closed", "Closed", false),
]);
const closedOnlyParent = parent("session-parent-closed", "Finished audit", [
  child("session-closed-2", "Audit pass", "closed", "Closed", false),
]);
const model: AgentsPaneModel = { parents: [activeParent, closedOnlyParent] };

function renderOverview(overrides: Partial<Parameters<typeof AgentsPaneOverview>[0]> = {}) {
  const onRetry = vi.fn();
  const onSelectParent = vi.fn();
  const view = render(
    <AgentsPaneOverview
      workspaceId={WORKSPACE_ID}
      model={model}
      loading={false}
      error={null}
      onRetry={onRetry}
      onSelectParent={onSelectParent}
      {...overrides}
    />,
  );
  return { view, onRetry, onSelectParent };
}

afterEach(cleanup);

describe("AgentsPaneOverview", () => {
  it("keeps every parent in server order, including the Closed-only parent, dimmed", () => {
    renderOverview();
    const rows = screen.getAllByRole("button");
    expect(rows.map((row) => row.querySelector("[title]")?.getAttribute("title"))).toEqual([
      "Feature build",
      "Finished audit",
    ]);
    expect(rows[1]?.className).toContain("opacity-60");
    expect(rows[0]?.className).not.toContain("opacity-60");
  });

  it("shows 12px Solid Seals in 20px stack slots with Closed dim and a count", () => {
    renderOverview();
    const activeRow = screen
      .getByTitle("Feature build")
      .closest('[role="button"]') as HTMLElement;
    const seals = activeRow.querySelectorAll("svg");
    expect(seals).toHaveLength(4);
    for (const seal of seals) {
      expect(seal.getAttribute("width")).toBe("12");
      expect(seal.querySelector("[data-solid-seal-notch]")).not.toBeNull();
    }
    const closedSeal = within(activeRow).getByLabelText("Identity mark for Old sweep");
    expect(closedSeal.style.opacity).toBe("0.45");
    const runningSeal = within(activeRow).getByLabelText("Identity mark for Explore dotfiles");
    expect(runningSeal.style.opacity).toBe("1");
    expect(activeRow.textContent).toContain("4");
    expect(
      screen.getByTitle("Finished audit").closest('[role="button"]')?.textContent,
    ).toContain("1");
  });

  it("clicking a parent selects that parent's cluster", () => {
    const { onSelectParent } = renderOverview();
    fireEvent.click(screen.getByTitle("Finished audit"));
    expect(onSelectParent).toHaveBeenCalledTimes(1);
    expect(onSelectParent).toHaveBeenCalledWith(closedOnlyParent);
  });

  it("shows loading before a model exists", () => {
    renderOverview({ model: null, loading: true });
    const statuses = screen.getAllByRole("status");
    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.textContent).toContain("Loading agents…");
  });

  it("shows the empty state for a model without parents", () => {
    renderOverview({ model: { parents: [] } });
    expect(screen.getByText("No agents yet")).toBeTruthy();
  });

  it("shows the initial error with a working Retry", () => {
    const { onRetry } = renderOverview({ model: null, error: "Could not load agents" });
    expect(screen.getByText("Could not load agents")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("keeps the roster mounted during a background refresh", () => {
    renderOverview({ backgroundRefreshing: true });
    expect(screen.getByRole("status", { name: "Refreshing agents" })).toBeTruthy();
    expect(screen.getByTitle("Feature build")).toBeTruthy();
  });
});

function renderCluster(target: AgentsPaneParent) {
  const onOpenDetail = vi.fn();
  const onAction = vi.fn();
  render(
    <AgentsPaneParentCluster
      workspaceId={WORKSPACE_ID}
      parent={target}
      onOpenDetail={onOpenDetail}
      onAction={onAction}
    />,
  );
  return { onOpenDetail, onAction };
}

describe("AgentsPaneParentCluster", () => {
  it("renders exactly the nonempty groups as headings in model order", () => {
    renderCluster(activeParent);
    expect(screen.getAllByRole("heading").map((heading) => heading.textContent)).toEqual([
      "Running",
      "Available",
      "Closed",
    ]);
    cleanup();
    renderCluster(closedOnlyParent);
    expect(screen.getAllByRole("heading").map((heading) => heading.textContent)).toEqual([
      "Closed",
    ]);
  });

  it("shows the truthful Failed detail for an errored Available child", () => {
    renderCluster(activeParent);
    const row = screen.getByTitle("Broken probe").closest("div");
    expect(row?.textContent).toContain("Failed");
  });

  it("never shows Idle, Done, Paused, or an agent kind", () => {
    const { container } = render(
      <AgentsPaneParentCluster
        workspaceId={WORKSPACE_ID}
        parent={activeParent}
        onOpenDetail={vi.fn()}
        onAction={vi.fn()}
      />,
    );
    for (const forbidden of ["Idle", "Done", "Paused", "agentKind", "claude", "codex"]) {
      expect(container.textContent).not.toContain(forbidden);
    }
  });

  it("keeps quiet actions as keyboard-reachable siblings, never nested buttons", () => {
    const { container } = render(
      <AgentsPaneParentCluster
        workspaceId={WORKSPACE_ID}
        parent={activeParent}
        onOpenDetail={vi.fn()}
        onAction={vi.fn()}
      />,
    );
    expect(container.querySelectorAll("button button")).toHaveLength(0);
    const close = screen.getByRole("button", { name: "Close Explore dotfiles" });
    expect(close.className).toContain("focus-visible:opacity-100");
  });

  it("offers Close/Promote on live children and only Open on Closed ones", () => {
    renderCluster(activeParent);
    expect(screen.getByRole("button", { name: "Close Explore dotfiles" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Promote Explore dotfiles" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Old sweep" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close Old sweep" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Promote Old sweep" })).toBeNull();
  });

  it("keeps Enter on a focused action with the action, never the row", () => {
    const { onOpenDetail } = renderCluster(activeParent);
    const promote = screen.getByRole("button", { name: "Promote Explore dotfiles" });
    promote.focus();
    fireEvent.keyDown(promote, { key: "Enter" });
    expect(onOpenDetail).not.toHaveBeenCalled();
  });

  it("routes the whole-row click to detail and action clicks to the action only", () => {
    const { onOpenDetail, onAction } = renderCluster(activeParent);
    fireEvent.click(screen.getByTitle("Explore dotfiles"));
    expect(onOpenDetail).toHaveBeenCalledTimes(1);
    expect(onOpenDetail.mock.calls[0]?.[0]?.sessionId).toBe("session-run-1");
    expect(onAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Promote Explore dotfiles" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0]?.[0]?.sessionId).toBe("session-run-1");
    expect(onAction.mock.calls[0]?.[1]).toBe("promote");
    expect(onOpenDetail).toHaveBeenCalledTimes(1);
  });
});
