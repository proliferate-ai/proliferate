/* @vitest-environment jsdom */

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POPOVER_FRAME_CLASS } from "../src/primitives/popover-surface";
import { Toaster, toast } from "../src/primitives/Sonner";

afterEach(() => {
  act(() => {
    toast.dismiss();
  });
  cleanup();
});

async function showToast(...args: Parameters<typeof toast>) {
  render(<Toaster />);
  act(() => {
    toast(...args);
  });
  return await waitFor(() => {
    const element = document.querySelector<HTMLElement>("[data-sonner-toast]");
    if (!element) {
      throw new Error("toast not rendered");
    }
    return element;
  });
}

describe("Toaster", () => {
  it("wears the canonical floating-panel chrome instead of a flat card", async () => {
    const element = await showToast("Workspace synced");

    // Toasts and popovers are the same kind of floating panel, so the frame is
    // shared by reference — a popover retune must reach the toast too.
    for (const utility of POPOVER_FRAME_CLASS.split(" ")) {
      expect(element.className).toContain(`!${utility}`);
    }
    // Sonner's own selectors outrank plain utilities; every owned property has
    // to be important or the default opaque card wins.
    expect(element.className).toContain("!p-3");
    expect(element.className).toContain("!text-ui-sm");
    expect(element.className).not.toContain("!border-border ");
  });

  it("keeps title, description, and the action pair on the closed ramp", async () => {
    const onAction = vi.fn();
    await showToast("Update ready", {
      description: "Proliferate 1.2.3 is ready.",
      action: { label: "Restart", onClick: onAction },
      cancel: { label: "Later", onClick: vi.fn() },
    });

    const title = document.querySelector<HTMLElement>("[data-title]");
    const description = document.querySelector<HTMLElement>("[data-description]");
    expect(title?.className).toContain("!text-ui-sm");
    expect(title?.className).toContain("!font-medium");
    expect(description?.className).toContain("!text-muted-foreground");

    // Only the primary action carries a fill; the secondary stays outlined so
    // one toast never shows two equally loud buttons.
    const action = screen.getByRole("button", { name: "Restart" });
    const cancel = screen.getByRole("button", { name: "Later" });
    expect(action.className).toContain("!bg-primary");
    expect(action.className).toContain("!h-6");
    expect(cancel.className).toContain("!bg-transparent");
    expect(cancel.className).toContain("!border-input");
    expect(cancel.className).toContain("!h-6");
  });

  it("lets a callsite override one slot without losing the rest of the kit", async () => {
    const element = await showToast("Update available", {
      classNames: { actionButton: "[&&]:!bg-surface-elevated-secondary" },
      action: { label: "Download", onClick: vi.fn() },
    });

    expect(element.className).toContain("!p-3");
    expect(
      screen.getByRole("button", { name: "Download" }).className,
    ).toContain("[&&]:!bg-surface-elevated-secondary");
  });
});
