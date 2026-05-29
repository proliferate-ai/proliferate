// @vitest-environment jsdom

import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SHORTCUT_REVEAL_DELAY_MS,
  SHORTCUT_REVEAL_RESET_EVENT,
  useShortcutRevealState,
} from "@/hooks/shortcuts/lifecycle/use-shortcut-reveal-state";
import {
  ShortcutRevealProvider,
  useShortcutRevealVisible,
} from "@/providers/ShortcutRevealProvider";

function ShortcutRevealProbe() {
  const visible = useShortcutRevealVisible();
  return <output aria-label="shortcut reveal visible">{String(visible)}</output>;
}

describe("useShortcutRevealState", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", {
      platform: "MacIntel",
      userAgent: "Mac OS X",
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reveals after the primary modifier is held for the delay", () => {
    expect(SHORTCUT_REVEAL_DELAY_MS).toBe(1000);
    const { result } = renderHook(() => useShortcutRevealState());

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Meta",
        metaKey: true,
      }));
      vi.advanceTimersByTime(SHORTCUT_REVEAL_DELAY_MS - 1);
    });
    expect(result.current).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(true);
  });

  it("resets on primary modifier keyup", () => {
    const { result } = renderHook(() => useShortcutRevealState());

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Meta",
        metaKey: true,
      }));
      vi.advanceTimersByTime(SHORTCUT_REVEAL_DELAY_MS);
    });
    expect(result.current).toBe(true);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keyup", {
        key: "Meta",
        metaKey: false,
      }));
    });
    expect(result.current).toBe(false);
  });

  it("does not reveal after a non-modifier key is pressed", () => {
    const { result } = renderHook(() => useShortcutRevealState());

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Meta",
        metaKey: true,
      }));
      vi.advanceTimersByTime(SHORTCUT_REVEAL_DELAY_MS / 2);
      window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "n",
        code: "KeyN",
        metaKey: true,
      }));
      vi.advanceTimersByTime(SHORTCUT_REVEAL_DELAY_MS);
    });

    expect(result.current).toBe(false);
  });

  it("resets when a registered shortcut is consumed", () => {
    const { result } = renderHook(() => useShortcutRevealState());

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Meta",
        metaKey: true,
      }));
      vi.advanceTimersByTime(SHORTCUT_REVEAL_DELAY_MS);
    });
    expect(result.current).toBe(true);

    act(() => {
      window.dispatchEvent(new Event(SHORTCUT_REVEAL_RESET_EVENT));
    });
    expect(result.current).toBe(false);
  });

  it("resets on window blur and hidden visibility", () => {
    const { result } = renderHook(() => useShortcutRevealState());

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Meta",
        metaKey: true,
      }));
      vi.advanceTimersByTime(SHORTCUT_REVEAL_DELAY_MS);
    });
    expect(result.current).toBe(true);

    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(result.current).toBe(false);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Meta",
        metaKey: true,
      }));
      vi.advanceTimersByTime(SHORTCUT_REVEAL_DELAY_MS);
    });
    expect(result.current).toBe(true);

    act(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current).toBe(false);
  });

  it("shares reveal visibility with consumers outside the provider subtree", () => {
    render(
      <>
        <ShortcutRevealProvider>
          <span>Lifecycle host</span>
        </ShortcutRevealProvider>
        <ShortcutRevealProbe />
      </>,
    );

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Meta",
        metaKey: true,
      }));
      vi.advanceTimersByTime(SHORTCUT_REVEAL_DELAY_MS);
    });

    expect(screen.getByLabelText("shortcut reveal visible").textContent).toBe("true");
  });
});
