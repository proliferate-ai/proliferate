// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  WorkspacesCommandList,
  type WorkspacesCommandGroupView,
  type WorkspacesCommandItemView,
} from "#product/components/workspace/repo-setup/WorkspacesCommandList";

function item(overrides: Partial<WorkspacesCommandItemView> = {}): WorkspacesCommandItemView {
  return {
    id: "ws-1",
    title: "Workspace one",
    branch: "feat/statuses",
    meta: "acme/repo",
    updatedLabel: "2h",
    ...overrides,
  };
}

function groups(items: WorkspacesCommandItemView[]): WorkspacesCommandGroupView[] {
  return [{ id: "today", label: "Today", items }];
}

beforeAll(() => {
  // cmdk scrolls the selected item into view; jsdom has no layout.
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
});

describe("WorkspacesCommandList", () => {
  it("renders the PR dot with its compound tooltip and number label", () => {
    render(
      <WorkspacesCommandList
        groups={groups([
          item({
            prStatus: {
              kind: "checks_failing",
              number: 805,
              label: "PR #805 · Open · Checks failing",
            },
            prNumberLabel: "#805",
          }),
        ])}
      />,
    );

    expect(screen.getByRole("img", { name: "PR #805 · Open · Checks failing" })).toBeTruthy();
    expect(screen.getByText("#805")).toBeTruthy();
  });

  it("shows a spinner in the leading well while the agent is running", () => {
    const { container } = render(
      <WorkspacesCommandList groups={groups([item({ running: true })])} />,
    );

    expect(container.querySelector("[data-loading-spinner]")).toBeTruthy();
  });

  it("tints the leading well destructive on merge conflicts", () => {
    render(
      <WorkspacesCommandList groups={groups([item({ attention: "conflicts" })])} />,
    );

    const well = screen.getByTitle("Merge conflicts in worktree");
    expect(well.className).toContain("text-destructive");
  });

  it("leaves the well empty when there is no git data at all", () => {
    const { container } = render(
      <WorkspacesCommandList
        groups={groups([item({ branch: null, prStatus: null })])}
      />,
    );

    expect(container.querySelector("svg.lucide-git-branch")).toBeNull();
    expect(container.querySelector("svg.lucide-git-pull-request")).toBeNull();
  });

  it("renders the ahead/behind label", () => {
    render(
      <WorkspacesCommandList groups={groups([item({ aheadBehindLabel: "↑2 ↓1" })])} />,
    );

    expect(screen.getByText("↑2 ↓1")).toBeTruthy();
  });

  it("renders the session count and omits it when there are none", () => {
    const { rerender } = render(
      <WorkspacesCommandList groups={groups([item({ sessionCount: 3 })])} />,
    );

    expect(screen.getByLabelText("3 sessions").textContent).toContain("3");

    rerender(<WorkspacesCommandList groups={groups([item({ sessionCount: 0 })])} />);
    expect(screen.queryByLabelText("0 sessions")).toBeNull();

    rerender(<WorkspacesCommandList groups={groups([item({ sessionCount: 1 })])} />);
    expect(screen.getByLabelText("1 session")).toBeTruthy();
  });

  it("badges non-local placement only when a label is supplied", () => {
    const { rerender } = render(
      <WorkspacesCommandList groups={groups([item({ placementLabel: "Cloud" })])} />,
    );

    expect(screen.getByText("Cloud")).toBeTruthy();

    rerender(<WorkspacesCommandList groups={groups([item({ placementLabel: null })])} />);
    expect(screen.queryByText("Cloud")).toBeNull();
  });

  it("matches the filter against the workspace name or branch only", () => {
    render(
      <WorkspacesCommandList
        groups={groups([
          item({ id: "ws-a", title: "Alpha", branch: "feat/statuses" }),
          item({ id: "ws-b", title: "Beta", branch: "fix/login" }),
        ])}
        onWorkspaceSelect={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText("Filter by name or branch...");

    fireEvent.change(input, { target: { value: "alpha" } });
    expect(screen.queryByText("Alpha")).toBeTruthy();
    expect(screen.queryByText("Beta")).toBeNull();

    fireEvent.change(input, { target: { value: "fix/login" } });
    expect(screen.queryByText("Alpha")).toBeNull();
    expect(screen.queryByText("Beta")).toBeTruthy();
  });

  it("does not match the filter against id, meta, PR number, or placement", () => {
    render(
      <WorkspacesCommandList
        groups={groups([
          item({
            id: "ws-pr",
            title: "Alpha",
            branch: null,
            meta: "acme/repo",
            prStatus: { kind: "open", number: 805 },
            prNumberLabel: "#805",
            placementLabel: "Cloud",
          }),
        ])}
        onWorkspaceSelect={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText("Filter by name or branch...");

    for (const query of ["ws-pr", "acme/repo", "#805", "Cloud"]) {
      fireEvent.change(input, { target: { value: query } });
      expect(screen.queryByText("Alpha")).toBeNull();
    }
  });
});
