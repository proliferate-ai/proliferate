/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReleaseNoticeCard } from "./ReleaseNoticeCard";

afterEach(cleanup);

describe("ReleaseNoticeCard", () => {
  it("renders an installed release as NEW with a quiet changelog action", () => {
    render(
      <ReleaseNoticeCard
        notice={{ version: "0.3.25", title: "Introducing Grok" }}
        onDismiss={vi.fn()}
        onOpenChangelog={vi.fn()}
      />,
    );

    expect(screen.getByRole("complementary", {
      name: "What's new in 0.3.25: Introducing Grok",
    })).not.toBeNull();
    const badge = screen.getByText("NEW");
    expect(badge.className).toContain("bg-sidebar-accent");
    expect(badge.className).toContain("text-sidebar-muted-foreground");
    expect(screen.queryByText("UPDATE")).toBeNull();
    expect(screen.getByText("Introducing Grok")).not.toBeNull();
    const changelog = screen.getByRole("button", {
      name: "Open changelog for 0.3.25",
    });
    expect(changelog.className).toContain("underline");
    expect(changelog.className).not.toContain("hover:bg-sidebar-accent");
  });

  it("forwards the dismiss and changelog actions with explicit accessible names", () => {
    const onDismiss = vi.fn();
    const onOpenChangelog = vi.fn();
    render(
      <ReleaseNoticeCard
        notice={{ version: "0.3.25", title: "Introducing Grok" }}
        onDismiss={onDismiss}
        onOpenChangelog={onOpenChangelog}
      />,
    );

    fireEvent.click(screen.getByRole("button", {
      name: "Dismiss release notice for 0.3.25",
    }));
    fireEvent.click(screen.getByRole("button", {
      name: "Open changelog for 0.3.25",
    }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onOpenChangelog).toHaveBeenCalledTimes(1);
  });

  it("supports keyboard focus and activation for both actions", async () => {
    const onDismiss = vi.fn();
    const onOpenChangelog = vi.fn();
    const user = userEvent.setup();
    render(
      <ReleaseNoticeCard
        notice={{ version: "0.3.25", title: "Introducing Grok" }}
        onDismiss={onDismiss}
        onOpenChangelog={onOpenChangelog}
      />,
    );
    const dismissButton = screen.getByRole("button", {
      name: "Dismiss release notice for 0.3.25",
    });
    const changelogButton = screen.getByRole("button", {
      name: "Open changelog for 0.3.25",
    });

    await user.tab();
    expect(document.activeElement).toBe(dismissButton);
    await user.keyboard("{Enter}");
    await user.tab();
    expect(document.activeElement).toBe(changelogButton);
    await user.keyboard(" ");

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onOpenChangelog).toHaveBeenCalledTimes(1);
  });

  it("wraps the maximum-length title without overflowing the card", () => {
    const title = "A".repeat(80);
    expect(title).toHaveLength(80);

    render(
      <ReleaseNoticeCard
        notice={{ version: "0.3.25", title }}
        onDismiss={vi.fn()}
        onOpenChangelog={vi.fn()}
      />,
    );

    const heading = screen.getByText(title);
    expect(heading.getAttribute("title")).toBe(title);
    expect(heading.className).toContain("whitespace-normal");
    expect(heading.className).toContain("break-words");
    expect(heading.className).toContain("[overflow-wrap:anywhere]");
  });
});
