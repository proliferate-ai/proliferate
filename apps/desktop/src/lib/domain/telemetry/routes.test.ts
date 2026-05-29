import { describe, expect, it } from "vitest";
import { resolveDesktopTelemetryRoute } from "./routes";

describe("resolveDesktopTelemetryRoute", () => {
  it("classifies known desktop routes", () => {
    expect(resolveDesktopTelemetryRoute("/")).toBe("main");
    expect(resolveDesktopTelemetryRoute("/login")).toBe("login");
    expect(resolveDesktopTelemetryRoute("/settings")).toBe("settings");
    expect(resolveDesktopTelemetryRoute("/automations")).toBe("automations");
    expect(resolveDesktopTelemetryRoute("/automations/run-1")).toBe("automations");
  });

  it("falls back to unknown for unclassified routes", () => {
    expect(resolveDesktopTelemetryRoute("/workspace")).toBe("unknown");
  });
});
