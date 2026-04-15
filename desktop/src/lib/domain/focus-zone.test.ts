import { afterEach, describe, expect, it, vi } from "vitest";
import { focusChatInput, focusTerminal, getFocusZone } from "@/lib/domain/focus-zone";

describe("focus-zone helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("derives the active focus zone from the nearest focus-zone ancestor", () => {
    vi.stubGlobal("document", {
      activeElement: {
        closest: vi.fn(() => ({
          getAttribute: vi.fn(() => "terminal"),
        })),
      },
    });

    expect(getFocusZone()).toBe("terminal");
  });

  it("focuses the chat textarea when the chat focus zone exists", () => {
    const focus = vi.fn();
    const querySelector = vi.fn(() => ({ focus }));
    vi.stubGlobal("document", {
      querySelector: vi.fn(() => ({ querySelector })),
    });

    expect(focusChatInput()).toBe(true);
    expect(querySelector).toHaveBeenCalledWith("textarea");
    expect(focus).toHaveBeenCalledWith({ preventScroll: false });
  });

  it("focuses xterm's helper textarea when the terminal focus zone exists", () => {
    const focus = vi.fn();
    const querySelector = vi.fn(() => ({ focus }));
    vi.stubGlobal("document", {
      querySelector: vi.fn(() => ({ querySelector })),
    });

    expect(focusTerminal()).toBe(true);
    expect(querySelector).toHaveBeenCalledWith(".xterm-helper-textarea");
    expect(focus).toHaveBeenCalledWith({ preventScroll: false });
  });
});
