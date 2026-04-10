import { beforeEach, describe, expect, it } from "vitest";
import {
  clearShortcutHandlerRegistryForTests,
  getShortcutHandler,
  registerShortcutHandler,
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
});
