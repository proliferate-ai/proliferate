// @vitest-environment jsdom

import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SHORTCUT_REVEAL_HOLD_MS,
  SHORTCUT_REVEAL_RESET_EVENT,
  useShortcutRevealState,
} from "#product/hooks/shortcuts/lifecycle/use-shortcut-reveal-state";
import {
  ShortcutRevealProvider,
  useShortcutRevealVisible,
} from "#product/providers/ShortcutRevealProvider";

function ShortcutRevealProbe() {
  const visible = useShortcutRevealVisible();
  return <output aria-label="shortcut reveal visible">{String(visible)}</output>;
}

function pressPrimaryModifier() {
  window.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Meta",
    metaKey: true,
  }));
}

function holdOutTheDelay() {
  vi.advanceTimersByTime(SHORTCUT_REVEAL_HOLD_MS);
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

  it("reveals only after the primary modifier is held out the delay", () => {
    const { result } = renderHook(() => useShortcutRevealState());

    act(() => {
      pressPrimaryModifier();
    });
    expect(result.current).toBe(false);

    act(() => {
      holdOutTheDelay();
    });
    expect(result.current).toBe(true);
  });

  it("never reveals when the modifier is released before the delay", () => {
    const { result } = renderHook(() => useShortcutRevealState());

    act(() => {
      pressPrimaryModifier();
      vi.advanceTimersByTime(SHORTCUT_REVEAL_HOLD_MS - 1);
      window.dispatchEvent(new KeyboardEvent("keyup", {
        key: "Meta",
        metaKey: false,
      }));
      holdOutTheDelay();
    });

    expect(result.current).toBe(false);
  });

  it("resets on primary modifier keyup", () => {
    const { result } = renderHook(() => useShortcutRevealState());

    act(() => {
      pressPrimaryModifier();
      holdOutTheDelay();
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

  it("does not reveal after a chorded non-modifier key is pressed", () => {
    const { result } = renderHook(() => useShortcutRevealState());

    act(() => {
      pressPrimaryModifier();
      window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "n",
        code: "KeyN",
        metaKey: true,
      }));
      holdOutTheDelay();
    });

    expect(result.current).toBe(false);
  });

  it("resets an already-visible reveal when a non-modifier key is pressed", () => {
    const { result } = renderHook(() => useShortcutRevealState());

    act(() => {
      pressPrimaryModifier();
      holdOutTheDelay();
    });
    expect(result.current).toBe(true);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "n",
        code: "KeyN",
        metaKey: true,
      }));
    });
    expect(result.current).toBe(false);
  });

  it("resets when a registered shortcut is consumed", () => {
    const { result } = renderHook(() => useShortcutRevealState());

    act(() => {
      pressPrimaryModifier();
      holdOutTheDelay();
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
      pressPrimaryModifier();
      holdOutTheDelay();
    });
    expect(result.current).toBe(true);

    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(result.current).toBe(false);

    act(() => {
      pressPrimaryModifier();
      holdOutTheDelay();
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
      pressPrimaryModifier();
      holdOutTheDelay();
    });

    expect(screen.getByLabelText("shortcut reveal visible").textContent).toBe("true");
  });
});
