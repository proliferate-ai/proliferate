/* @vitest-environment jsdom */

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Toaster, toast } from "#product/primitives/Sonner";

afterEach(() => {
  act(() => {
    toast.dismiss();
  });
  cleanup();
  delete document.documentElement.dataset.mode;
});

async function showRawToast(...args: Parameters<typeof toast>) {
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
  it("strips the shell to a transparent positioner so the body owns the card", async () => {
    const element = await showRawToast("Workspace synced");

    // The bodies rendered through `showToast` paint the whole card — frame,
    // padding, close, the details transform. Sonner's own selectors outrank
    // plain utilities, so every neutralized property has to be important or
    // the default opaque card wins. `!w-auto` is the load-bearing one: it is
    // what lets a card that widens in place decide the shell's width instead
    // of being clipped by it.
    for (const utility of [
      "!w-auto",
      "!gap-0",
      "!rounded-none",
      "!border-0",
      "!bg-transparent",
      "!p-0",
      "!shadow-none",
    ]) {
      expect(element.className).toContain(utility);
    }
    // The group name the card's focus ring reads (see `TOAST_CARD_CLASS`).
    expect(element.className).toContain("group/toast");
  });

  it("takes its theme from the app's mode, not the OS", async () => {
    document.documentElement.dataset.mode = "light";
    await showRawToast("Workspace synced");

    // Sonner's theme picks the `--normal-*` fallbacks sitting behind everything
    // the kit overrides. Pinned to dark, those stayed black under a light
    // surface — so the fallback has to track the same attribute the stylesheet
    // does.
    const readTheme = () =>
      document
        .querySelector<HTMLElement>("[data-sonner-toaster]")
        ?.getAttribute("data-sonner-theme");
    expect(readTheme()).toBe("light");

    await act(async () => {
      document.documentElement.dataset.mode = "dark";
    });
    await waitFor(() => {
      expect(readTheme()).toBe("dark");
    });
  });

  it("lets a callsite override one slot without losing the rest of the kit", async () => {
    const element = await showRawToast("Update available", {
      classNames: { title: "[&&]:!text-ui" },
    });

    expect(element.className).toContain("!w-auto");
    expect(element.className).toContain("!p-0");
    expect(
      document.querySelector<HTMLElement>("[data-title]")?.className,
    ).toContain("[&&]:!text-ui");
  });
});
