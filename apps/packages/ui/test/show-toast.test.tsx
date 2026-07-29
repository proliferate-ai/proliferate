/* @vitest-environment jsdom */

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_VISIBLE_TOASTS, toast } from "../src/primitives/Sonner";
import { ToastHost } from "../src/patterns/ToastHost";
import { dismissToast, showToast, toastError } from "../src/utils/show-toast";
import type { ToastInput } from "../src/utils/toast-model";

afterEach(() => {
  act(() => {
    toast.dismiss();
  });
  cleanup();
});

async function raise(...inputs: ToastInput[]) {
  render(<ToastHost />);
  act(() => {
    for (const input of inputs) {
      showToast(input);
    }
  });
  return await waitFor(() => {
    const nodes = document.querySelectorAll<HTMLElement>("[data-sonner-toast]");
    if (nodes.length === 0) {
      throw new Error("no toast rendered");
    }
    return nodes;
  });
}

describe("showToast — status", () => {
  it("renders one line with a tone dot and no action buttons", async () => {
    await raise({ message: "Workspace archived", tone: "success" });

    expect(screen.getByText("Workspace archived")).toBeTruthy();
    expect(screen.getByTestId("toast-tone-dot").className).toContain("bg-success");
    expect(screen.queryAllByRole("button", { name: /details|copy/i })).toEqual([]);
  });

  it("truncates rather than wrapping, keeping the full string on title", async () => {
    const long = "This message is comfortably longer than a single status line allows";
    await raise({ message: long });

    const line = screen.getByText(long);
    expect(line.className).toContain("truncate");
    expect(line.className).toContain("whitespace-nowrap");
    expect(line.getAttribute("title")).toBe(long);
  });

  it("renders a short mono code suffix without promoting the weight", async () => {
    await raise({ message: "Sync finished", code: "12 files" });

    expect(screen.getByText("12 files").className).toContain("font-mono");
  });
});

describe("showToast — announcement", () => {
  it("stacks badge, wrapping title, description and one solid commit", async () => {
    const commit = vi.fn();
    await raise({
      weight: "announcement",
      badge: "UPDATE",
      tone: "success",
      title: "Proliferate 0.4.1 is ready",
      description: "Restart takes about 5 seconds.",
      secondary: { label: "Later", onClick: () => {} },
      commit: { label: "Restart", onClick: commit },
    });

    expect(screen.getByText("UPDATE")).toBeTruthy();
    const title = screen.getByText("Proliferate 0.4.1 is ready");
    expect(title.className).toContain("whitespace-normal");
    expect(screen.getByText("Restart takes about 5 seconds.")).toBeTruthy();

    // Exactly one button carries a fill: the committing one.
    const later = screen.getByRole("button", { name: "Later" });
    const restart = screen.getByRole("button", { name: "Restart" });
    expect(later.className).toContain("bg-surface-elevated-secondary");
    expect(later.className).toContain("border-input");
    expect(restart.className).not.toContain("bg-surface-elevated-secondary");

    act(() => {
      restart.click();
    });
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("clamps a description past two lines of characters", async () => {
    const long = "x".repeat(300);
    await raise({ weight: "announcement", title: "Heads up", description: long });

    const rendered = screen.getByText(/x+…$/);
    expect(rendered.textContent!.length).toBeLessThan(long.length);
  });
});

describe("showToast — detail", () => {
  it("renders at most three countable lines plus an overflow count", async () => {
    await raise({
      weight: "detail",
      title: "5 files could not be staged",
      payload: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"].join("\n"),
    });

    const excerpt = screen.getByTestId("toast-excerpt");
    expect(excerpt.textContent).toContain("a.ts");
    expect(excerpt.textContent).toContain("c.ts");
    expect(excerpt.textContent).not.toContain("d.ts");
    expect(screen.getByText("+2 more")).toBeTruthy();
  });

  it("never renders a stack trace inline, and offers no Copy for it", async () => {
    await raise({
      weight: "detail",
      title: "The run crashed",
      payload: [
        "TypeError: undefined is not a function",
        "    at step (run.ts:10:1)",
      ].join("\n"),
    });

    expect(screen.queryByTestId("toast-excerpt")).toBeNull();
    expect(screen.queryByText(/at step/)).toBeNull();
    // Copy complements an excerpt; with no excerpt the payload belongs to the
    // details modal instead.
    expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
  });

  it("copies the whole payload, not just the visible excerpt", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const payload = ["a.ts", "b.ts", "c.ts", "d.ts"].join("\n");
    await raise({ weight: "detail", title: "4 files", payload });

    act(() => {
      screen.getByRole("button", { name: "Copy" }).click();
    });
    expect(writeText).toHaveBeenCalledWith(payload);
  });
});

describe("showToast — details destinations", () => {
  it("navigate follows the pointer and dismisses the toast", async () => {
    const onNavigate = vi.fn();
    await raise({
      id: "nav",
      weight: "announcement",
      title: "A run failed",
      details: { kind: "navigate", label: "Open run", onNavigate },
    });

    act(() => {
      screen.getByRole("button", { name: "Open run" }).click();
    });
    expect(onNavigate).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByText("A run failed")).toBeNull();
    });
  });

  it("modal opens the compact details terminus, which carries no Retry", async () => {
    await raise({
      weight: "announcement",
      title: "Provisioning failed",
      details: {
        kind: "modal",
        title: "Provisioning failed",
        subtitle: "worker-3",
        payload: "boom\n  at thing",
      },
    });

    act(() => {
      screen.getByRole("button", { name: "Details" }).click();
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Copy details" })).toBeTruthy();
    });
    expect(screen.getByText("worker-3")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });

  it("none renders no Details button at all", async () => {
    await raise({
      weight: "announcement",
      title: "Nothing to read",
      details: { kind: "none" },
    });

    expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
  });
});

describe("showToast — hard limits", () => {
  it("shows at most three toasts at once", async () => {
    await raise(
      { id: "a", message: "one" },
      { id: "b", message: "two" },
      { id: "c", message: "three" },
      { id: "d", message: "four" },
    );

    await waitFor(() => {
      const visible = [...document.querySelectorAll<HTMLElement>("[data-sonner-toast]")]
        .filter((node) => node.getAttribute("data-visible") !== "false");
      expect(visible.length).toBeLessThanOrEqual(MAX_VISIBLE_TOASTS);
    });
  });

  it("replaces rather than stacks when the same id is reused", async () => {
    render(<ToastHost />);
    act(() => {
      showToast({ id: "same", message: "first" });
    });
    await waitFor(() => screen.getByText("first"));
    act(() => {
      showToast({ id: "same", message: "second" });
    });

    await waitFor(() => {
      expect(screen.getByText("second")).toBeTruthy();
    });
    expect(screen.queryByText("first")).toBeNull();
    expect(document.querySelectorAll("[data-sonner-toast]")).toHaveLength(1);
  });

  it("reports the dismissal so a same-id caller can stop re-raising it", async () => {
    const onDismiss = vi.fn();
    await raise({ id: "dismissable", message: "Close me", onDismiss });

    act(() => {
      dismissToast("dismissable");
    });
    await waitFor(() => {
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });
});

describe("toastError", () => {
  async function raiseError(input: Parameters<typeof toastError>[0]) {
    render(<ToastHost />);
    act(() => {
      toastError(input);
    });
    return await waitFor(() => {
      const nodes = document.querySelectorAll<HTMLElement>("[data-sonner-toast]");
      if (nodes.length === 0) {
        throw new Error("no toast rendered");
      }
      return nodes;
    });
  }

  it("renders the outcome and consequence, and the cause nowhere", async () => {
    await raiseError({
      headline: "Message not sent",
      consequence: "Your message is still in the composer, unsent.",
      cause: "Pending prompt not found",
    });

    expect(screen.getByText("Message not sent")).toBeTruthy();
    expect(screen.getByText("Your message is still in the composer, unsent.")).toBeTruthy();
    // The whole point of the shape: the exception is present in the toast's
    // data and absent from its pixels until someone asks for it.
    expect(screen.queryByText(/Pending prompt not found/)).toBeNull();
  });

  it("puts the cause behind Details, in the modal that can hold it", async () => {
    await raiseError({
      headline: "Run did not start",
      cause: "TypeError: undefined is not a function\n  at step (run.ts:10:1)",
    });

    act(() => {
      screen.getByRole("button", { name: "Details" }).click();
    });
    await waitFor(() => {
      expect(screen.getByText(/at step \(run\.ts:10:1\)/)).toBeTruthy();
    });
  });

  it("offers Retry as the one filled action and calls it", async () => {
    const retry = vi.fn();
    await raiseError({ headline: "Message not sent", cause: "boom", retry });

    const retryButton = screen.getByRole("button", { name: "Retry" });
    const details = screen.getByRole("button", { name: "Details" });
    expect(details.className).toContain("bg-surface-elevated-secondary");
    expect(retryButton.className).not.toContain("bg-surface-elevated-secondary");

    act(() => {
      retryButton.click();
    });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("offers no Retry when the caller cannot re-run the action", async () => {
    await raiseError({ headline: "Link did not open" });

    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
  });
});
