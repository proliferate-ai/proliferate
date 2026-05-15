// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SubagentWakeBadge } from "./SubagentWakeBadge";

describe("SubagentWakeBadge", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps the wake receipt at chat text size when rendered as a button", () => {
    const { container } = render(
      <SubagentWakeBadge
        label="explore-dotfiles"
        childSessionId="child-session"
        sessionLinkId="session-link"
        onOpenChild={() => {}}
      />,
    );

    const chip = container.querySelector("button");
    expect(chip?.className).toContain("text-[length:var(--text-chat)]");
  });

  it("does not render a visible Open suffix for clickable wake receipts", () => {
    const { container } = render(
      <SubagentWakeBadge
        label="explore-dotfiles"
        childSessionId="child-session"
        sessionLinkId="session-link"
        onOpenChild={() => {}}
      />,
    );

    const chip = container.querySelector("button");
    expect(chip?.textContent).toContain("finished a turn");
    expect(chip?.textContent).not.toContain("Open");
  });

  it("renders clickable wake receipts directly without a hover-card wrapper", () => {
    const { container } = render(
      <SubagentWakeBadge
        label="explore-dotfiles"
        childSessionId="child-session"
        sessionLinkId="session-link"
        onOpenChild={() => {}}
      />,
    );

    expect(container.firstElementChild?.tagName).toBe("BUTTON");
    expect(container.querySelector("button")?.className).toContain("max-w-[77%]");
  });
});
