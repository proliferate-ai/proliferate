import { describe, expect, it } from "vitest";
import { SHORTCUTS } from "@/config/shortcuts";
import { getShortcutNativeAccelerator } from "@/lib/domain/shortcuts/native-accelerators";

describe("getShortcutNativeAccelerator", () => {
  it("converts fixed primary-modifier shortcuts to Tauri accelerators", () => {
    expect(getShortcutNativeAccelerator(SHORTCUTS.closeActiveTab)).toBe("CmdOrCtrl+W");
    expect(getShortcutNativeAccelerator(SHORTCUTS.openSettings)).toBe("CmdOrCtrl+Comma");
    expect(getShortcutNativeAccelerator(SHORTCUTS.renameSession)).toBe("CmdOrCtrl+R");
    expect(getShortcutNativeAccelerator(SHORTCUTS.closeOtherTabs)).toBe("CmdOrCtrl+Shift+O");
    expect(getShortcutNativeAccelerator(SHORTCUTS.closeTabsToRight)).toBe("CmdOrCtrl+Shift+R");
  });

  it("converts modifier and named-key shortcuts", () => {
    expect(getShortcutNativeAccelerator(SHORTCUTS.previousTab)).toBe("CmdOrCtrl+Alt+Left");
  });

  it("does not invent accelerators for shortcut ranges or platform-specific matches", () => {
    expect(getShortcutNativeAccelerator(SHORTCUTS.tabByIndex)).toBeNull();
    expect(getShortcutNativeAccelerator(SHORTCUTS.goHome)).toBeNull();
    expect(getShortcutNativeAccelerator(SHORTCUTS.newCloud)).toBeNull();
  });
});
