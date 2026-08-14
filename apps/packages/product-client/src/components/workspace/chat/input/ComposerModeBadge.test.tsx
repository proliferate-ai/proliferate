// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposerModeBadge } from "#product/components/workspace/chat/input/ComposerModeBadge";
import type { LiveSessionControlDescriptor } from "#product/lib/domain/chat/session-controls/session-controls";

afterEach(cleanup);

function createModeControl(
  selectedValue: string,
  overrides: Partial<LiveSessionControlDescriptor> = {},
): LiveSessionControlDescriptor & { key: "mode" } {
  return {
    key: "mode",
    label: "Permissions",
    detail: "Plan",
    rawConfigId: "mode",
    settable: true,
    pendingState: null,
    kind: "select",
    options: [
      { value: "plan", label: "Plan", selected: selectedValue === "plan", description: "Plan without execution." },
      { value: "default", label: "Default", selected: selectedValue === "default" },
      { value: "bypassPermissions", label: "Bypass", selected: selectedValue === "bypassPermissions" },
    ],
    onSelect: vi.fn(),
    ...overrides,
  };
}

describe("ComposerModeBadge", () => {
  it("names the mode and its description without rendering a word", () => {
    render(<ComposerModeBadge agentKind="claude" control={createModeControl("plan")} />);

    const badge = screen.getByRole("button", {
      name: "Permissions: Plan — Plan without execution.",
    });
    expect(badge.querySelector("svg")).not.toBeNull();
    // Icon-only at every width: the badge paints no word at all, and the mode
    // name reaches a screen reader through the aria-label the getByRole query
    // above already matched — not through a duplicate sr-only span.
    expect(badge.textContent).toBe("");
    expect(badge.getAttribute("aria-label")).toContain("Plan");
    expect(screen.queryByText("Plan")).toBeNull();
  });

  it("advances to the next mode on click and wraps at the end", () => {
    const control = createModeControl("bypassPermissions");
    render(<ComposerModeBadge agentKind="claude" control={control} />);

    const badge = screen.getByRole("button", { name: /Permissions: Bypass/ });
    expect(badge.getAttribute("data-session-mode-next")).toBe("plan");
    fireEvent.click(badge);
    expect(control.onSelect).toHaveBeenCalledWith("plan");
  });

  it("keys the glyph on the mode value so each step replays the drop-in", () => {
    const { rerender } = render(
      <ComposerModeBadge agentKind="claude" control={createModeControl("plan")} />,
    );
    const planGlyph = screen.getByRole("button", { name: /Permissions: Plan/ })
      .querySelector(".composer-mode-badge-glyph svg");

    rerender(
      <ComposerModeBadge agentKind="claude" control={createModeControl("bypassPermissions")} />,
    );
    const bypassGlyph = screen.getByRole("button", { name: /Permissions: Bypass/ })
      .querySelector(".composer-mode-badge-glyph svg");

    expect(planGlyph).not.toBeNull();
    expect(bypassGlyph).not.toBe(planGlyph);
  });

  it("stamps the selected and next mode for automation", () => {
    render(<ComposerModeBadge agentKind="claude" control={createModeControl("default")} />);

    const badge = screen.getByRole("button", { name: /Permissions: Default/ });
    expect(badge.getAttribute("data-session-mode-trigger")).toBe("");
    expect(badge.getAttribute("data-session-mode-selected")).toBe("default");
    expect(badge.getAttribute("data-session-mode-next")).toBe("bypassPermissions");
  });

  it("disables the badge when the mode is not settable", () => {
    const control = createModeControl("plan", { settable: false });
    render(<ComposerModeBadge agentKind="claude" control={control} />);

    const badge = screen.getByRole("button", { name: /Permissions: Plan/ });
    expect(badge).toHaveProperty("disabled", true);
    fireEvent.click(badge);
    expect(control.onSelect).not.toHaveBeenCalled();
  });
});
