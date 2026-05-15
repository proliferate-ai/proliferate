// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SubagentWakeBadge } from "./SubagentWakeBadge";

describe("SubagentWakeBadge", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders wake receipts as sentence-style transcript text", () => {
    const { container } = render(
      <SubagentWakeBadge
        label="explore-dotfiles"
        childSessionId="child-session"
        sessionLinkId="session-link"
        onOpenChild={() => {}}
      />,
    );

    const receipt = container.querySelector("p");
    expect(receipt?.className).toContain("text-chat");
    expect(receipt?.className).toContain("text-muted-foreground");
    expect(receipt?.textContent).toContain("finished a turn.");
  });

  it("renders the delegated identity as the only clickable target", () => {
    const onOpenChild = vi.fn();
    const { container } = render(
      <SubagentWakeBadge
        label="explore-dotfiles"
        childSessionId="child-session"
        sessionLinkId="session-link"
        onOpenChild={onOpenChild}
      />,
    );

    const openButton = screen.getByRole("button", { name: /Open .*explore-dotfiles/ });
    expect(openButton.textContent).not.toContain("finished a turn");
    fireEvent.click(openButton);
    expect(onOpenChild).toHaveBeenCalledWith("child-session");
    expect(container.querySelectorAll("button")).toHaveLength(1);
  });

  it("renders receipts without a chip shell", () => {
    const { container } = render(
      <SubagentWakeBadge
        label="explore-dotfiles"
        childSessionId="child-session"
        sessionLinkId="session-link"
        onOpenChild={() => {}}
      />,
    );

    expect(container.firstElementChild?.tagName).toBe("P");
    expect(container.firstElementChild?.className).toContain("max-w-[77%]");
    expect(container.firstElementChild?.className).not.toContain("rounded-2xl");
    expect(container.firstElementChild?.className).not.toContain("bg-foreground/5");
  });
});
