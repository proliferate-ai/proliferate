import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildProliferateApiUrlMock: vi.fn((path: string) => `https://self.example${path}`),
}));

vi.mock("@/lib/infra/proliferate-api", () => ({
  buildProliferateApiUrl: mocks.buildProliferateApiUrlMock,
}));

async function loadConfigModule() {
  vi.resetModules();
  return import("./config");
}

describe("getAnonymousTelemetryEndpoint", () => {
  beforeEach(() => {
    mocks.buildProliferateApiUrlMock.mockClear();
    vi.unstubAllEnvs();
  });

  it("defaults to the resolved API base URL", async () => {
    const config = await loadConfigModule();

    expect(config.getAnonymousTelemetryEndpoint()).toBe(
      "https://self.example/v1/telemetry/anonymous",
    );
    expect(mocks.buildProliferateApiUrlMock).toHaveBeenCalledWith(
      "/v1/telemetry/anonymous",
    );
  });

  it("prefers an explicit telemetry endpoint override", async () => {
    vi.stubEnv(
      "VITE_PROLIFERATE_ANONYMOUS_TELEMETRY_ENDPOINT",
      "https://collector.example/v1/telemetry/anonymous",
    );

    const config = await loadConfigModule();

    expect(config.getAnonymousTelemetryEndpoint()).toBe(
      "https://collector.example/v1/telemetry/anonymous",
    );
  });
});
