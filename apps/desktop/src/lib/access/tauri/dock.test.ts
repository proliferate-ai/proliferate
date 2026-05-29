// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  setWorkspaceActivityIndicator,
} from "@/lib/access/tauri/dock";

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauriMocks.invoke,
}));

describe("setWorkspaceActivityIndicator", () => {
  beforeEach(() => {
    tauriMocks.invoke.mockReset();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("does nothing outside the Tauri desktop runtime", async () => {
    await setWorkspaceActivityIndicator({
      state: "attention",
      attentionCount: 1,
    });

    expect(tauriMocks.invoke).not.toHaveBeenCalled();
  });

  it("invokes the native Dock badge command when Tauri is available", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });

    await setWorkspaceActivityIndicator({
      state: "attention",
      attentionCount: 1,
    });

    expect(tauriMocks.invoke).toHaveBeenCalledWith(
      "set_workspace_activity_indicator",
      {
        state: "attention",
        attentionCount: 1,
      },
    );
  });
});
