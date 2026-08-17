// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { setWindowTheme } from "@/lib/access/tauri/window";

const tauriMocks = vi.hoisted(() => ({
  setTheme: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setTheme: tauriMocks.setTheme }),
}));

describe("setWindowTheme", () => {
  beforeEach(() => {
    tauriMocks.setTheme.mockReset();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("does nothing outside the Tauri desktop runtime", async () => {
    await setWindowTheme("dark");

    expect(tauriMocks.setTheme).not.toHaveBeenCalled();
  });

  it("applies the selected product theme to the current native window", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });

    await setWindowTheme("light");

    expect(tauriMocks.setTheme).toHaveBeenCalledExactlyOnceWith("light");
  });

  it("clears the native override for system mode", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });

    await setWindowTheme(null);

    expect(tauriMocks.setTheme).toHaveBeenCalledExactlyOnceWith(null);
  });
});
