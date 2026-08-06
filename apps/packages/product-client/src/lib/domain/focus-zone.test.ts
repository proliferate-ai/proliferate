import { afterEach, describe, expect, it, vi } from "vitest";
import {
  focusChatInput,
  focusChatInputOnActivation,
  focusTerminal,
  getFocusZone,
  isRightPanelFocusZone,
} from "#product/lib/domain/focus-zone";

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

  it("classifies the right panel and its hosted surfaces as right-panel focus", () => {
    expect(isRightPanelFocusZone("right-panel")).toBe(true);
    expect(isRightPanelFocusZone("terminal")).toBe(true);
    expect(isRightPanelFocusZone("chat")).toBe(false);
  });

  it("focuses the chat composer editor when the chat focus zone exists", () => {
    const focus = vi.fn();
    const querySelector = vi.fn(() => ({ focus }));
    vi.stubGlobal("document", {
      querySelector: vi.fn(() => ({ querySelector })),
    });

    expect(focusChatInput()).toBe(true);
    expect(querySelector).toHaveBeenCalledWith("[data-chat-composer-editor], textarea");
    expect(focus).toHaveBeenCalledWith({ preventScroll: false });
  });

  it("focuses the chat composer on activation when nothing owns focus", () => {
    const focus = vi.fn();
    const querySelector = vi.fn(() => ({ focus }));
    vi.stubGlobal("document", {
      activeElement: null,
      querySelector: vi.fn(() => ({ querySelector, closest: vi.fn(() => null) })),
    });
    vi.stubGlobal("window", {
      getSelection: vi.fn(() => ({ isCollapsed: true })),
    });

    expect(focusChatInputOnActivation()).toBe(true);
    expect(focus).toHaveBeenCalledWith({ preventScroll: false });
  });

  it("restores composer focus from a non-interactive chat-zone surface", () => {
    const focus = vi.fn();
    const querySelector = vi.fn(() => ({ focus }));
    const activeZone = { getAttribute: vi.fn(() => "chat") };
    vi.stubGlobal("document", {
      body: {},
      activeElement: {
        closest: vi.fn((selector: string) =>
          (selector === "[data-focus-zone]" ? activeZone : null)),
      },
      querySelector: vi.fn(() => ({ querySelector, closest: vi.fn(() => null) })),
    });
    vi.stubGlobal("window", {
      getSelection: vi.fn(() => ({ isCollapsed: true })),
    });

    expect(focusChatInputOnActivation()).toBe(true);
    expect(focus).toHaveBeenCalledWith({ preventScroll: false });
  });

  it("does not focus a composer kept mounted inside a hidden or inert route host", () => {
    const editorQuerySelector = vi.fn();
    const closest = vi.fn(() => ({}));
    vi.stubGlobal("document", {
      activeElement: null,
      querySelector: vi.fn(() => ({
        querySelector: editorQuerySelector,
        closest,
      })),
    });
    vi.stubGlobal("window", {
      getSelection: vi.fn(() => ({ isCollapsed: true })),
    });

    expect(focusChatInputOnActivation()).toBe(false);
    expect(closest).toHaveBeenCalledWith('[aria-hidden="true"], [inert]');
    expect(editorQuerySelector).not.toHaveBeenCalled();
  });

  it("does not steal activation focus from a surface outside the chat zone", () => {
    const documentQuerySelector = vi.fn();
    vi.stubGlobal("document", {
      body: {},
      activeElement: { closest: vi.fn(() => null) },
      querySelector: documentQuerySelector,
    });
    vi.stubGlobal("window", {
      getSelection: vi.fn(() => ({ isCollapsed: true })),
    });

    expect(focusChatInputOnActivation()).toBe(false);
    expect(documentQuerySelector).not.toHaveBeenCalled();
  });

  it("does not steal activation focus from an interactive chat-zone control", () => {
    const documentQuerySelector = vi.fn();
    const chatZone = { getAttribute: vi.fn(() => "chat") };
    vi.stubGlobal("document", {
      body: {},
      activeElement: {
        closest: vi.fn((selector: string) =>
          (selector === "[data-focus-zone]" ? chatZone : {})),
      },
      querySelector: documentQuerySelector,
    });
    vi.stubGlobal("window", {
      getSelection: vi.fn(() => ({ isCollapsed: true })),
    });

    expect(focusChatInputOnActivation()).toBe(false);
    expect(documentQuerySelector).not.toHaveBeenCalled();
  });

  it("does not collapse a live text selection on activation", () => {
    const documentQuerySelector = vi.fn();
    vi.stubGlobal("document", {
      activeElement: null,
      querySelector: documentQuerySelector,
    });
    vi.stubGlobal("window", {
      getSelection: vi.fn(() => ({ isCollapsed: false })),
    });

    expect(focusChatInputOnActivation()).toBe(false);
    expect(documentQuerySelector).not.toHaveBeenCalled();
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
