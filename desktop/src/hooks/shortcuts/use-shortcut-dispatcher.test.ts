import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveKeyboardShortcut } from "@/hooks/shortcuts/use-shortcut-dispatcher";

describe("resolveKeyboardShortcut", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", {
      platform: "Linux x86_64",
      userAgent: "Linux",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps non-mac new cloud distinct from new local", () => {
    expect(resolveKeyboardShortcut({
      key: "n",
      code: "KeyN",
      metaKey: false,
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
    } as KeyboardEvent)).toEqual({
      id: "workspace.new-local",
      shortcut: expect.objectContaining({ id: "workspace.new-local" }),
      trigger: expect.objectContaining({ source: "keyboard" }),
    });

    expect(resolveKeyboardShortcut({
      key: "n",
      code: "KeyN",
      metaKey: false,
      ctrlKey: true,
      shiftKey: false,
      altKey: true,
    } as KeyboardEvent)).toEqual({
      id: "workspace.new-cloud",
      shortcut: expect.objectContaining({ id: "workspace.new-cloud" }),
      trigger: expect.objectContaining({ source: "keyboard" }),
    });
  });
});
