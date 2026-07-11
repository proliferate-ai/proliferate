import { beforeEach, describe, expect, it, vi } from "vitest";

const updaterMocks = vi.hoisted(() => ({
  check: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => updaterMocks);

import { checkForUpdate } from "@/lib/access/tauri/updater";

describe("Tauri updater access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves manifest notes from the Tauri body as the target title", async () => {
    const update = {
      version: "0.3.25",
      body: "Introducing Grok",
      downloadAndInstall: vi.fn(),
    };
    updaterMocks.check.mockResolvedValue(update);

    await expect(checkForUpdate()).resolves.toEqual({
      kind: "available",
      version: "0.3.25",
      title: "Introducing Grok",
      update,
    });
  });

  it("keeps an available update valid when the manifest has no notes", async () => {
    const update = { version: "0.3.25", downloadAndInstall: vi.fn() };
    updaterMocks.check.mockResolvedValue(update);

    await expect(checkForUpdate()).resolves.toEqual({
      kind: "available",
      version: "0.3.25",
      title: null,
      update,
    });
  });
});
