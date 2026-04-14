import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  logRendererDiagnosticMock: vi.fn(),
}));

vi.mock("@/platform/tauri/diagnostics", () => ({
  logRendererDiagnostic: mocks.logRendererDiagnosticMock,
}));

type Listener = (event: any) => void;

async function loadNativeDiagnostics() {
  vi.resetModules();
  return import("./native-diagnostics");
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("native diagnostics", () => {
  let listeners: Map<string, Listener>;

  beforeEach(() => {
    listeners = new Map();
    mocks.logRendererDiagnosticMock.mockReset();
    mocks.logRendererDiagnosticMock.mockResolvedValue(undefined);
    vi.stubGlobal("window", {
      location: { pathname: "/settings/agents" },
      addEventListener: vi.fn((type: string, listener: Listener) => {
        listeners.set(type, listener);
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("registers global listeners once and forwards uncaught errors", async () => {
    const diagnostics = await loadNativeDiagnostics();

    diagnostics.initializeDesktopNativeDiagnostics();
    diagnostics.initializeDesktopNativeDiagnostics();

    expect(window.addEventListener).toHaveBeenCalledTimes(2);
    expect(listeners.has("error")).toBe(true);
    expect(listeners.has("unhandledrejection")).toBe(true);

    const error = new Error("renderer blew up");
    listeners.get("error")?.({ error, message: error.message });
    await flushMicrotasks();

    expect(mocks.logRendererDiagnosticMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "window.error",
        message: "renderer blew up",
        route: "/settings/agents",
      }),
    );
  });

  it("dedupes repeated React render errors within the debounce window", async () => {
    const diagnostics = await loadNativeDiagnostics();
    const error = new Error("same render failure");

    diagnostics.reportReactRenderError(error, "at App");
    diagnostics.reportReactRenderError(error, "at App");
    await flushMicrotasks();

    expect(mocks.logRendererDiagnosticMock).toHaveBeenCalledTimes(1);
    expect(mocks.logRendererDiagnosticMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "react.render",
        message: "same render failure",
        componentStack: "at App",
      }),
    );
  });
});
