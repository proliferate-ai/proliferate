// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProductSidebarWorkspaceRow } from "./ProductSidebarRepositories";

afterEach(cleanup);

describe("ProductSidebarWorkspaceRow trailing slot", () => {
  it("renders the quieter unread dot in the shared right slot instead of the date", () => {
    render(
      <ProductSidebarWorkspaceRow
        label="Unread workspace"
        unreadDot
        trailingLabel="2m"
      />,
    );

    const unreadDot = screen.getByRole("img", { name: "Unseen activity" });
    expect(unreadDot.className).toContain("icon-status");
    expect(unreadDot.className).toContain("bg-info/70");
    expect(screen.queryByText("2m")).toBeNull();
    expect(unreadDot.closest(".grid")?.className).toContain("min-w-[26px]");
  });

  it("gives live status precedence over unread and date in that same slot", () => {
    render(
      <ProductSidebarWorkspaceRow
        label="Running workspace"
        trailingStatus={<span data-testid="running-status">Running</span>}
        unreadDot
        trailingLabel="now"
      />,
    );

    expect(screen.getByTestId("running-status")).not.toBeNull();
    expect(screen.queryByRole("img", { name: "Unseen activity" })).toBeNull();
    expect(screen.queryByText("now")).toBeNull();
  });

  it("uses the same right-slot geometry for an idle date", () => {
    render(
      <ProductSidebarWorkspaceRow label="Idle workspace" trailingLabel="4h" />,
    );

    const date = screen.getByText("4h");
    expect(date.closest(".grid")?.className).toContain("min-w-[26px]");
  });
});
