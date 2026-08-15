import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tauri: true,
  install: vi.fn(),
  initializeErrors: vi.fn(),
}));

vi.mock("@/lib/access/tauri/diagnostics", () => ({
  isTauriDesktop: () => mocks.tauri,
}));
vi.mock("./renderer-diagnostics", () => ({
  installRendererDiagnostics: mocks.install,
}));
vi.mock("./renderer-error-diagnostics", () => ({
  initializeDesktopRendererErrorDiagnostics: mocks.initializeErrors,
}));

describe("renderer diagnostics early side-effect install", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.tauri = true;
  });

  it("contains install failure so entrypoint module evaluation can continue", async () => {
    mocks.install.mockImplementationOnce(() => {
      throw new Error("diagnostics install failure");
    });

    await expect(import("./renderer-diagnostics-install")).resolves.toBeDefined();
    expect(mocks.install).toHaveBeenCalledOnce();
    expect(mocks.initializeErrors).toHaveBeenCalledOnce();
  });

  it("contains independent error-listener installation failure", async () => {
    mocks.initializeErrors.mockImplementationOnce(() => {
      throw new Error("error listener install failure");
    });

    await expect(import("./renderer-diagnostics-install")).resolves.toBeDefined();
    expect(mocks.install).toHaveBeenCalledOnce();
    expect(mocks.initializeErrors).toHaveBeenCalledOnce();
  });

  it("remains inert outside the embedded Tauri WebView", async () => {
    mocks.tauri = false;

    await expect(import("./renderer-diagnostics-install")).resolves.toBeDefined();
    expect(mocks.install).not.toHaveBeenCalled();
    expect(mocks.initializeErrors).not.toHaveBeenCalled();
  });
});
