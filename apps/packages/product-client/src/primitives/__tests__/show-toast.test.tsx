/* @vitest-environment jsdom */

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_VISIBLE_TOASTS, toast } from "#product/primitives/Sonner";
import { ToastHost } from "#product/primitives/patterns/ToastHost";
import { dismissToast, showToast, toastError } from "#product/primitives/utils/show-toast";
import type { ToastInput } from "#product/primitives/utils/toast-model";

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

  it("speaks the severity the dot carries, since a colour reads as nothing", async () => {
    // On a status line the dot is the *only* severity signal — the message text
    // carries no "Failed"/"Done" marker of its own — and the dot is aria-hidden,
    // so without this "Couldn't save" and "Saved" reach a screen reader as the
    // same sentence.
    await raise({ message: "Couldn't save the workspace", tone: "destructive" });

    const label = screen.getByText("Error:", { exact: false });
    expect(label.className).toContain("sr-only");
    expect(screen.getByTestId("toast-tone-dot").getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  it("stays silent for neutral, which is the absence of severity", async () => {
    // Prefixing every ordinary status line with "Neutral" is noise, not
    // information.
    await raise({ message: "Workspace saved" });

    const [node] = document.querySelectorAll<HTMLElement>("[data-sonner-toast]");
    expect(node.querySelector(".sr-only")).toBeNull();
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

describe("showToast — the X", () => {
  it("is always visible, owns dismissal, and reports it", async () => {
    const onDismiss = vi.fn();
    await raise({ message: "Close me", onDismiss });

    const close = screen.getByRole("button", { name: "Close" });
    // Always visible: the reveal-on-hover treatment is gone, so the control
    // must not depend on a hover class to become interactive.
    expect(close.className).not.toContain("opacity-0");

    act(() => {
      close.click();
    });
    await waitFor(() => {
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.queryByText("Close me")).toBeNull();
    });
  });

  it("sits on every weight", async () => {
    await raise({ weight: "announcement", title: "Heads up" });

    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
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

  it("never renders a stack trace inline — it waits behind Details", async () => {
    await raise({
      weight: "detail",
      title: "The run crashed",
      payload: [
        "TypeError: undefined is not a function",
        "    at step (run.ts:10:1)",
      ].join("\n"),
    });

    expect(screen.queryByTestId("toast-excerpt")).toBeNull();
    // The payload is mounted — the unfold animation needs it — but a payload
    // that failed the excerpt test stays out of the accessibility tree and
    // behind the clip until Details is pressed.
    expect(
      screen.getByText(/at step/).closest("[aria-hidden='true']"),
    ).not.toBeNull();
    // A blob payload earns the Details toggle even when the caller never
    // spelled out a details destination: the strip is the only surface that
    // can hold it.
    expect(screen.getByRole("button", { name: "Details" })).toBeTruthy();
    // Copy complements an excerpt; with no excerpt, the payload belongs to the
    // expanded strip and its own Copy details.
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

  it("inline expands the toast in place, reversibly", async () => {
    await raise({
      weight: "announcement",
      title: "Provisioning failed",
      details: { kind: "inline", payload: "boom\n  at thing" },
    });

    const details = screen.getByRole("button", { name: "Details" });
    expect(details.getAttribute("aria-expanded")).toBe("false");
    expect(
      screen.getByText(/at thing/).closest("[aria-hidden='true']"),
    ).not.toBeNull();

    act(() => {
      details.click();
    });
    expect(details.getAttribute("aria-expanded")).toBe("true");
    expect(details.textContent).toBe("Collapse");
    // Expanded, the strip is a region labelled by the toast's own title
    // rather than a hidden clip.
    expect(
      screen.getByRole("region", { name: "Provisioning failed" }).textContent,
    ).toContain("at thing");

    act(() => {
      details.click();
    });
    expect(details.getAttribute("aria-expanded")).toBe("false");
    expect(details.textContent).toBe("Details");
  });

  it("Copy details rides along only while expanded, and copies the payload", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    await raise({
      weight: "announcement",
      title: "Update failed",
      details: { kind: "inline", payload: "signature verification failed" },
    });

    expect(screen.queryByRole("button", { name: "Copy details" })).toBeNull();
    act(() => {
      screen.getByRole("button", { name: "Details" }).click();
    });
    const copy = screen.getByRole("button", { name: "Copy details" });
    act(() => {
      copy.click();
    });
    expect(writeText).toHaveBeenCalledWith("signature verification failed");
    expect(copy.textContent).toBe("Copied");
  });

  it("expanding one toast collapses any other", async () => {
    await raise(
      {
        id: "first",
        weight: "announcement",
        title: "First failed",
        details: { kind: "inline", payload: "cause one" },
      },
      {
        id: "second",
        weight: "announcement",
        title: "Second failed",
        details: { kind: "inline", payload: "cause two" },
      },
    );

    const toggles = screen.getAllByRole("button", { name: "Details" });
    expect(toggles).toHaveLength(2);
    act(() => {
      toggles[0].click();
    });
    expect(toggles[0].getAttribute("aria-expanded")).toBe("true");
    act(() => {
      toggles[1].click();
    });
    expect(toggles[1].getAttribute("aria-expanded")).toBe("true");
    // One id is the whole expansion state, so exclusivity is structural.
    expect(toggles[0].getAttribute("aria-expanded")).toBe("false");
  });

  it("Retry collapses the expansion on its way to the action", async () => {
    const retry = vi.fn();
    await raise({
      weight: "announcement",
      title: "Update failed",
      details: { kind: "inline", payload: "cause" },
      commit: { label: "Retry", onClick: retry },
    });

    act(() => {
      screen.getByRole("button", { name: "Details" }).click();
    });
    act(() => {
      screen.getByRole("button", { name: "Retry" }).click();
    });
    expect(retry).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Details" }).getAttribute("aria-expanded"),
    ).toBe("false");
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

  it("renders the outcome and consequence, and the cause only behind the clip", async () => {
    await raiseError({
      headline: "Message not sent",
      consequence: "Your message is still in the composer, unsent.",
      cause: "Pending prompt not found",
    });

    expect(screen.getByText("Message not sent")).toBeTruthy();
    expect(screen.getByText("Your message is still in the composer, unsent.")).toBeTruthy();
    // The whole point of the shape: the exception is present in the toast's
    // data — mounted for the unfold — and absent from its presentation until
    // someone asks for it.
    expect(
      screen.getByText(/Pending prompt not found/).closest("[aria-hidden='true']"),
    ).not.toBeNull();
  });

  it("puts the cause behind Details, in the strip that can hold it", async () => {
    await raiseError({
      headline: "Run did not start",
      cause: "TypeError: undefined is not a function\n  at step (run.ts:10:1)",
    });

    act(() => {
      screen.getByRole("button", { name: "Details" }).click();
    });
    await waitFor(() => {
      expect(
        screen.getByRole("region", { name: "Run did not start" }).textContent,
      ).toContain("at step (run.ts:10:1)");
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
