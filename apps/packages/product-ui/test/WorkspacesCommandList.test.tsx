// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  WorkspacesCommandList,
  type WorkspacesCommandGroupView,
  type WorkspacesCommandItemView,
} from "../src/workspaces/WorkspacesCommandList";

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

  it("matches the filter against the PR number", () => {
    render(
      <WorkspacesCommandList
        groups={groups([
          item({
            id: "ws-pr",
            title: "Alpha",
            prStatus: { kind: "open", number: 805 },
            prNumberLabel: "#805",
          }),
          item({ id: "ws-plain", title: "Beta" }),
        ])}
        onWorkspaceSelect={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Filter workspaces..."), {
      target: { value: "#805" },
    });

    expect(screen.queryByText("Alpha")).toBeTruthy();
    expect(screen.queryByText("Beta")).toBeNull();
  });
});
