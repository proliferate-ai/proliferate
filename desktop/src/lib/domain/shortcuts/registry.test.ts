import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearShortcutHandlerRegistryForTests,
  getShortcutHandler,
  registerShortcutHandler,
  runShortcutHandler,
} from "@/lib/domain/shortcuts/registry";

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

  it("throws on duplicate registrations in dev", () => {
    registerShortcutHandler("app.open-settings", () => {});

    expect(() => {
      registerShortcutHandler("app.open-settings", () => {});
    }).toThrowError("Duplicate shortcut handler registration for app.open-settings");
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
