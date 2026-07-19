import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearShortcutHandlerRegistryForTests,
  getShortcutHandler,
  registerShortcutHandler,
  runShortcutHandler,
} from "#product/lib/domain/shortcuts/registry";

describe("shortcut registry", () => {
  beforeEach(() => {
    clearShortcutHandlerRegistryForTests();
  });

  it("registers and unregisters handlers", () => {
    const cleanup = registerShortcutHandler("app.open-settings", () => {});

    expect(getShortcutHandler("app.open-settings")).not.toBeNull();

    cleanup();

    expect(getShortcutHandler("app.open-settings")).toBeNull();
  });

  it("uses the latest duplicate registration and restores the previous handler on cleanup", () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();

    const cleanupA = registerShortcutHandler("app.open-settings", firstHandler);
    const cleanupB = registerShortcutHandler("app.open-settings", secondHandler);

    expect(consoleWarn).toHaveBeenCalledWith(
      "Duplicate shortcut handler registration for app.open-settings at global priority; using latest same-priority handler",
    );

    expect(runShortcutHandler("app.open-settings", { source: "keyboard" })).toBe(true);
    expect(firstHandler).not.toHaveBeenCalled();
    expect(secondHandler).toHaveBeenCalledWith({ source: "keyboard" });

    cleanupB();

    expect(runShortcutHandler("app.open-settings", { source: "menu" })).toBe(true);
    expect(firstHandler).toHaveBeenCalledWith({ source: "menu" });

    cleanupA();
    consoleWarn.mockRestore();
  });

  it("keeps contextual ownership above a later global registration", () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const contextualHandler = vi.fn();
    const globalHandler = vi.fn();

    const cleanupContextual = registerShortcutHandler(
      "workspace.new-default",
      contextualHandler,
      { priority: "contextual" },
    );
    const cleanupGlobal = registerShortcutHandler("workspace.new-default", globalHandler);

    expect(consoleWarn).not.toHaveBeenCalled();
    expect(runShortcutHandler("workspace.new-default", { source: "keyboard" })).toBe(true);
    expect(contextualHandler).toHaveBeenCalledWith({ source: "keyboard" });
    expect(globalHandler).not.toHaveBeenCalled();

    cleanupContextual();
    expect(runShortcutHandler("workspace.new-default", { source: "menu" })).toBe(true);
    expect(globalHandler).toHaveBeenCalledWith({ source: "menu" });

    cleanupGlobal();
    consoleWarn.mockRestore();
  });

  it("uses registration order only to break ties between contextual owners", () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const globalHandler = vi.fn();
    const contextualA = vi.fn();
    const contextualB = vi.fn();
    const cleanupGlobal = registerShortcutHandler("workspace.new-default", globalHandler);
    const cleanupA = registerShortcutHandler("workspace.new-default", contextualA, {
      priority: "contextual",
    });
    const cleanupB = registerShortcutHandler("workspace.new-default", contextualB, {
      priority: "contextual",
    });

    expect(consoleWarn).toHaveBeenCalledWith(
      "Duplicate shortcut handler registration for workspace.new-default at contextual priority; using latest same-priority handler",
    );
    expect(runShortcutHandler("workspace.new-default", { source: "keyboard" })).toBe(true);
    expect(contextualB).toHaveBeenCalledTimes(1);
    expect(contextualA).not.toHaveBeenCalled();
    expect(globalHandler).not.toHaveBeenCalled();

    cleanupB();
    expect(runShortcutHandler("workspace.new-default", { source: "keyboard" })).toBe(true);
    expect(contextualA).toHaveBeenCalledTimes(1);

    cleanupA();
    expect(runShortcutHandler("workspace.new-default", { source: "keyboard" })).toBe(true);
    expect(globalHandler).toHaveBeenCalledTimes(1);

    cleanupGlobal();
    consoleWarn.mockRestore();
  });

  it("throws on unknown shortcut ids in dev", () => {
    expect(() => {
      registerShortcutHandler("shortcut.typo" as "app.open-settings", () => {});
    }).toThrowError("Unknown shortcut handler registration for shortcut.typo");
  });

  it("does not let stale cleanup remove a newer handler", () => {
    const cleanupA = registerShortcutHandler("app.open-settings", () => {});
    cleanupA();

    const cleanupB = registerShortcutHandler("app.open-settings", () => {});

    cleanupA();
    expect(getShortcutHandler("app.open-settings")).not.toBeNull();

    cleanupB();
    expect(getShortcutHandler("app.open-settings")).toBeNull();
  });

  it("returns false when running a missing handler", () => {
    expect(runShortcutHandler("app.open-settings", { source: "palette" })).toBe(false);
  });

  it("treats void handler returns as consumed", () => {
    const handler = vi.fn();
    registerShortcutHandler("app.open-settings", handler);

    expect(runShortcutHandler("app.open-settings", { source: "palette" })).toBe(true);
    expect(handler).toHaveBeenCalledWith({ source: "palette" });
  });

  it("preserves false handler returns as unconsumed", () => {
    registerShortcutHandler("app.open-settings", () => false);

    expect(runShortcutHandler("app.open-settings", { source: "keyboard" })).toBe(false);
  });

  it("catches thrown handler errors and returns unconsumed", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    registerShortcutHandler("app.open-settings", () => {
      throw new Error("boom");
    });

    expect(runShortcutHandler("app.open-settings", { source: "menu" })).toBe(false);
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to handle shortcut app.open-settings",
      expect.any(Error),
    );

    consoleError.mockRestore();
  });
});
