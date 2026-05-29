import { describe, expect, it } from "vitest";
import { SHORTCUTS } from "@/config/shortcuts";
import { getShortcutNativeAccelerator } from "@/lib/domain/shortcuts/native-accelerators";

describe("getShortcutNativeAccelerator", () => {
  it("converts fixed primary-modifier shortcuts to Tauri accelerators", () => {
    expect(getShortcutNativeAccelerator(SHORTCUTS.closeActiveTab)).toBe("CmdOrCtrl+W");
    expect(getShortcutNativeAccelerator(SHORTCUTS.openSettings)).toBe("CmdOrCtrl+Comma");
    expect(getShortcutNativeAccelerator(SHORTCUTS.newSessionTab)).toBe("CmdOrCtrl+T");
    expect(getShortcutNativeAccelerator(SHORTCUTS.renameSession)).toBe("CmdOrCtrl+Alt+R");
    expect(getShortcutNativeAccelerator(SHORTCUTS.closeOtherTabs)).toBe("CmdOrCtrl+Alt+O");
  });

  it("converts simple physical letter shortcuts to native accelerators", () => {
    expect(getShortcutNativeAccelerator(SHORTCUTS.copyWorkspacePath)).toBe("CmdOrCtrl+Shift+C");
    expect(getShortcutNativeAccelerator(SHORTCUTS.copyBranchName)).toBe("CmdOrCtrl+Alt+C");
  });

  it("does not invent native accelerators for physical-key shortcuts", () => {
    expect(getShortcutNativeAccelerator(SHORTCUTS.previousTab)).toBeNull();
  });

  it("does not invent accelerators for shortcut ranges or platform-specific matches", () => {
    expect(getShortcutNativeAccelerator(SHORTCUTS.tabByIndex)).toBeNull();
    expect(getShortcutNativeAccelerator(SHORTCUTS.increaseTextSize)).toBeNull();
    expect(getShortcutNativeAccelerator(SHORTCUTS.newWorktree)).toBeNull();
    expect(getShortcutNativeAccelerator(SHORTCUTS.newCloud)).toBeNull();
  });
});
