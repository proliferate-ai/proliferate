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

    const receipt = container.querySelector("button");
    expect(receipt?.className).toContain("text-chat");
    expect(receipt?.className).toContain("text-muted-foreground");
    expect(receipt?.textContent).toContain("finished a turn.");
  });

  it("opens the child session from the full receipt", () => {
    const onOpenChild = vi.fn();
    const { container } = render(
      <SubagentWakeBadge
        label="explore-dotfiles"
        childSessionId="child-session"
        sessionLinkId="session-link"
        onOpenChild={onOpenChild}
      />,
    );

    const receiptButton = screen.getByRole("button", { name: "Open explore-dotfiles session" });
    expect(receiptButton.textContent).toContain("finished a turn.");
    fireEvent.click(screen.getByText("finished a turn."));
    expect(onOpenChild).toHaveBeenCalledWith("child-session");
    expect(container.querySelectorAll("button")).toHaveLength(1);
  });

  it("renders static receipt text when no child target exists", () => {
    render(
      <SubagentWakeBadge
        label="explore-dotfiles"
        sessionLinkId="session-link"
        onOpenChild={() => {}}
      />,
    );

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("finished a turn.")).toBeTruthy();
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

    expect(container.firstElementChild?.tagName).toBe("BUTTON");
    expect(container.firstElementChild?.className).toContain("max-w-[77%]");
    expect(container.firstElementChild?.className).not.toContain("rounded-2xl");
    expect(container.firstElementChild?.className).not.toContain("bg-foreground/5");
  });
});
