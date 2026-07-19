import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  logRendererDiagnosticMock: vi.fn(),
}));

vi.mock("@/lib/access/tauri/diagnostics", () => ({
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
    vi.stubEnv("DEV", true);
    vi.spyOn(console, "warn").mockImplementation(() => {});
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
    vi.unstubAllEnvs();
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

  it("suppresses stackless local dev network load rejections", async () => {
    const diagnostics = await loadNativeDiagnostics();

    diagnostics.initializeDesktopNativeDiagnostics();

    const error = new TypeError("Load failed");
    Object.defineProperty(error, "stack", { value: undefined });
    listeners.get("unhandledrejection")?.({ reason: error });
    await flushMicrotasks();

    expect(mocks.logRendererDiagnosticMock).not.toHaveBeenCalled();
  });

  it("dedupes repeated React render errors within the debounce window", async () => {
    const diagnostics = await loadNativeDiagnostics();
    const error = new Error("same render failure");

    const first = diagnostics.reportReactRenderError(error, "at App");
    const duplicate = diagnostics.reportReactRenderError(error, "at App");

    await expect(first).resolves.toBe(true);
    await expect(duplicate).resolves.toBe(true);
    expect(mocks.logRendererDiagnosticMock).toHaveBeenCalledTimes(1);
    expect(mocks.logRendererDiagnosticMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "react.render",
        message: "same render failure",
        componentStack: "at App",
      }),
    );
  });

  it("confirms persistence success and reports native write failure honestly", async () => {
    const diagnostics = await loadNativeDiagnostics();
    await expect(
      diagnostics.reportReactRenderError(new Error("persisted"), "at App"),
    ).resolves.toBe(true);

    mocks.logRendererDiagnosticMock.mockRejectedValueOnce(new Error("native log unavailable"));
    await expect(
      diagnostics.reportReactRenderError(new Error("not persisted"), "at App"),
    ).resolves.toBe(false);
  });

  it("shares an in-flight result and permits retry after persistence fails", async () => {
    const diagnostics = await loadNativeDiagnostics();
    const error = new Error("retryable persistence");
    let rejectPersistence: ((reason: Error) => void) | undefined;
    mocks.logRendererDiagnosticMock.mockImplementationOnce(
      () => new Promise((_resolve, reject) => {
        rejectPersistence = reject;
      }),
    );

    const first = diagnostics.reportReactRenderError(error, "at App");
    const duplicate = diagnostics.reportReactRenderError(error, "at App");
    rejectPersistence?.(new Error("native log unavailable"));

    await expect(first).resolves.toBe(false);
    await expect(duplicate).resolves.toBe(false);
    expect(mocks.logRendererDiagnosticMock).toHaveBeenCalledTimes(1);

    mocks.logRendererDiagnosticMock.mockResolvedValueOnce(undefined);
    await expect(
      diagnostics.reportReactRenderError(error, "at App"),
    ).resolves.toBe(true);
    expect(mocks.logRendererDiagnosticMock).toHaveBeenCalledTimes(2);
  });
});
