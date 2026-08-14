import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tauri: false,
  invoke: vi.fn(),
  getConfig: vi.fn(() => ({ release: "desktop@test", environment: "test" })),
  randomUUID: vi.fn(() => "renderer-boot-id"),
  setTimeout: vi.fn(() => 1),
}));

vi.mock("@/lib/access/tauri/diagnostics", () => ({
  isTauriDesktop: () => mocks.tauri,
  ingestRendererDiagnosticsBatch: mocks.invoke,
}));
vi.mock("@/lib/integrations/telemetry/config", () => ({
  getDesktopTelemetryConfig: mocks.getConfig,
}));

import {
  installRendererDiagnostics,
  RendererDiagnosticsRuntime,
  resetRendererDiagnosticsForTest,
} from "./renderer-diagnostics";

describe("renderer diagnostics installation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tauri = false;
    vi.stubGlobal("crypto", { randomUUID: mocks.randomUUID });
    vi.stubGlobal("window", {
      setTimeout: mocks.setTimeout,
      clearTimeout: vi.fn(),
      addEventListener: vi.fn(),
      location: { pathname: "/" },
    });
    vi.stubGlobal("document", {
      addEventListener: vi.fn(),
      visibilityState: "visible",
    });
  });

  afterEach(() => {
    resetRendererDiagnosticsForTest();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("is inert in browser-only Desktop Vite mode", () => {
    expect(installRendererDiagnostics()).toBe(false);
    expect(mocks.getConfig).not.toHaveBeenCalled();
    expect(mocks.randomUUID).not.toHaveBeenCalled();
    expect(mocks.setTimeout).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("installs one producer in an embedded Tauri realm", () => {
    mocks.tauri = true;
    const flush = vi.spyOn(RendererDiagnosticsRuntime.prototype, "flush")
      .mockResolvedValue(undefined);

    expect(installRendererDiagnostics()).toBe(true);
    expect(installRendererDiagnostics()).toBe(true);
    expect(mocks.getConfig).toHaveBeenCalledOnce();
    expect(mocks.randomUUID).toHaveBeenCalledOnce();
    expect(window.addEventListener).toHaveBeenCalledWith("pagehide", expect.any(Function));
    expect(document.addEventListener).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );
    expect(window.addEventListener).toHaveBeenCalledTimes(1);
    expect(document.addEventListener).toHaveBeenCalledTimes(1);

    const visibilityListener = (
      vi.mocked(document.addEventListener).mock.calls[0][1]
    ) as EventListener;
    const pagehideListener = (
      vi.mocked(window.addEventListener).mock.calls[0][1]
    ) as EventListener;
    visibilityListener(new Event("visibilitychange"));
    expect(flush).not.toHaveBeenCalled();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    visibilityListener(new Event("visibilitychange"));
    pagehideListener(new Event("pagehide"));
    expect(flush.mock.calls).toEqual([[100], [100]]);
  });
});
