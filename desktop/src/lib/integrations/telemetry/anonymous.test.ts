import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadAnonymousTelemetryBootstrapMock: vi.fn(),
  saveAnonymousTelemetryStateMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("./anonymous-storage", () => ({
  loadAnonymousTelemetryBootstrap: mocks.loadAnonymousTelemetryBootstrapMock,
  saveAnonymousTelemetryState: mocks.saveAnonymousTelemetryStateMock,
}));

async function loadAnonymousModule() {
  vi.resetModules();
  return import("./anonymous");
}

describe("initializeAnonymousTelemetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("DEV", true);
    vi.stubGlobal("fetch", mocks.fetchMock);
    mocks.loadAnonymousTelemetryBootstrapMock.mockReset();
    mocks.saveAnonymousTelemetryStateMock.mockReset();
    mocks.fetchMock.mockReset();
    mocks.loadAnonymousTelemetryBootstrapMock.mockResolvedValue({
      installId: "install-123",
      appVersion: "0.1.0",
      platform: "darwin",
      arch: "arm64",
      state: {
        schemaVersion: 1,
        sentMilestones: [],
        pendingMilestones: [],
        usageCounters: {
          sessionsStarted: 0,
          promptsSubmitted: 0,
          workspacesCreatedLocal: 0,
          workspacesCreatedCloud: 0,
          credentialsSynced: 0,
          connectorsInstalled: 0,
        },
        lastUsageFlushedAt: null,
      },
    });
    mocks.saveAnonymousTelemetryStateMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("suppresses expected local_dev network warnings for the initial heartbeat", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.fetchMock.mockRejectedValue(new TypeError("Load failed"));

    const anonymous = await loadAnonymousModule();

    await anonymous.initializeAnonymousTelemetry({
      endpoint: "https://self.example/v1/telemetry/anonymous",
      telemetryMode: "local_dev",
    });

    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("keeps warning for network failures outside local_dev", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.fetchMock.mockRejectedValue(new TypeError("Load failed"));

    const anonymous = await loadAnonymousModule();

    await anonymous.initializeAnonymousTelemetry({
      endpoint: "https://self.example/v1/telemetry/anonymous",
      telemetryMode: "self_managed",
    });

    expect(warnSpy).toHaveBeenCalledWith(
      "Failed to send initial anonymous telemetry heartbeat",
      expect.any(TypeError),
    );

    warnSpy.mockRestore();
  });
});
