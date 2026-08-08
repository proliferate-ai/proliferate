// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SubagentWakeBadge } from "#product/components/workspace/chat/transcript/SubagentWakeBadge";
import { shortDelegatedWorkId } from "#product/lib/domain/delegated-work/identity";

describe("SubagentWakeBadge", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders an inbound receipt as verb-then-chip", () => {
    const { container } = render(
      <SubagentWakeBadge
        label="explore-dotfiles"
        childSessionId="child-session"
        sessionLinkId="session-link"
        onOpenChild={() => {}}
      />,
    );

    // Direction is a side: inbound leads with the verb, then the chip — the
    // mirror of an outgoing receipt, which leads with the chip.
    const row = container.querySelector("[data-agent-inbound-receipt]");
    expect(row?.textContent).toBe("finishedexplore-dotfiles");
    const chip = container.querySelector("[data-agent-chip]");
    expect(chip?.className).toContain("h-7");
    expect(chip?.className).toContain("rounded-full");
    // A pointer never carries turn output, so the verb stops at "finished".
    expect(row?.textContent).not.toContain("a turn");
  });

  it("opens the agent from its chip", () => {
    const onOpenChild = vi.fn();
    render(
      <SubagentWakeBadge
        label="explore-dotfiles"
        childSessionId="child-session"
        sessionLinkId="session-link"
        onOpenChild={onOpenChild}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open explore-dotfiles" }));
    expect(onOpenChild).toHaveBeenCalledWith("child-session");
  });

  it("renders a static chip when there is no session to open", () => {
    const { container } = render(
      <SubagentWakeBadge
        label="explore-dotfiles"
        sessionLinkId="session-link"
        onOpenChild={() => {}}
      />,
    );

    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector("[data-agent-chip]")).toBeTruthy();
  });

  it("rides the short id on a pointer that carried no link", () => {
    const { container } = render(
      <SubagentWakeBadge
        label="Fix flaky worktree cleanup"
        childSessionId="sess_7d41f2b8"
        titleFallback="Agent"
        onOpenChild={() => {}}
      />,
    );

    // Cross-session addressing stays visible: the mono short id rides in the
    // chip because no link resolved the target.
    const chip = container.querySelector("[data-agent-chip]");
    expect(chip?.textContent).toContain(shortDelegatedWorkId("sess_7d41f2b8"));
    expect(chip?.querySelector(".font-mono")).toBeTruthy();
  });

  it("reports how the turn ended when a completion row says", () => {
    const { container } = render(
      <SubagentWakeBadge
        label="explore-dotfiles"
        childSessionId="child-session"
        sessionLinkId="session-link"
        outcome="failed"
      />,
    );

    expect(container.textContent).toContain("failed");
  });
});
