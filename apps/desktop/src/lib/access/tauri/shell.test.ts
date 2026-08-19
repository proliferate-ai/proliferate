import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  homeDir: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("@tauri-apps/api/path", () => ({
  homeDir: mocks.homeDir,
}));

async function loadShell() {
  vi.resetModules();
  return import("./shell");
}

beforeEach(() => {
  mocks.homeDir.mockReset();
  mocks.invoke.mockReset();
});

describe("inspectPath", () => {
  it.each([
    { kind: "file" },
    { kind: "directory" },
    { kind: "missing" },
    { kind: "unavailable", reason: "invalid_path" },
    { kind: "unavailable", reason: "permission_denied" },
    { kind: "unavailable", reason: "unsupported_type" },
    { kind: "unavailable", reason: "io_error" },
  ] as const)("preserves the validated native payload $kind $reason", async (payload) => {
    const shell = await loadShell();
    mocks.invoke.mockResolvedValue(payload);

    await expect(shell.inspectPath("/private/repo/file.txt")).resolves.toBe(payload);
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("inspect_path", {
      path: "/private/repo/file.txt",
    });
  });

  it.each([
    null,
    [],
    "file",
    { kind: "other" },
    { kind: "unavailable" },
    { kind: "unavailable", reason: "other" },
    { kind: "file", path: "/private/secret" },
    { kind: "unavailable", reason: "io_error", path: "/private/secret" },
  ])("rejects malformed payload %# with one fixed path-free error", async (payload) => {
    const shell = await loadShell();
    mocks.invoke.mockResolvedValue(payload);

    let rejection: unknown;
    try {
      await shell.inspectPath("/private/secret");
    } catch (error) {
      rejection = error;
    }

    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toBe("Invalid inspect_path response.");
  });

  it("preserves invoke rejection", async () => {
    const shell = await loadShell();
    const transportError = new Error("native transport unavailable");
    mocks.invoke.mockRejectedValue(transportError);

    await expect(shell.inspectPath("/private/repo/file.txt")).rejects.toBe(transportError);
  });
});

describe("getHomeDir", () => {
  it("caches only a successful native home lookup", async () => {
    const shell = await loadShell();
    mocks.homeDir.mockResolvedValue("/Users/example");

    await expect(shell.getHomeDir()).resolves.toBe("/Users/example");
    await expect(shell.getHomeDir()).resolves.toBe("/Users/example");
    expect(mocks.homeDir).toHaveBeenCalledTimes(1);
  });

  it("keeps native rejection and never substitutes /tmp", async () => {
    const shell = await loadShell();
    const lookupError = new Error("home lookup failed");
    mocks.homeDir.mockRejectedValue(lookupError);

    await expect(shell.getHomeDir()).rejects.toBe(lookupError);
    await expect(shell.getHomeDir()).rejects.toBe(lookupError);
    expect(mocks.homeDir).toHaveBeenCalledTimes(2);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
