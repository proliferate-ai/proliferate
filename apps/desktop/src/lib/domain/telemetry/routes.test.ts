import { describe, expect, it } from "vitest";
import { resolveDesktopTelemetryRoute } from "./routes";

describe("resolveDesktopTelemetryRoute", () => {
  it("classifies known desktop routes", () => {
    expect(resolveDesktopTelemetryRoute("/")).toBe("main");
    expect(resolveDesktopTelemetryRoute("/login")).toBe("login");
    expect(resolveDesktopTelemetryRoute("/settings")).toBe("settings");
    expect(resolveDesktopTelemetryRoute("/integrations")).toBe("integrations");
    expect(resolveDesktopTelemetryRoute("/plugins")).toBe("integrations");
    expect(resolveDesktopTelemetryRoute("/workflows")).toBe("workflows");
    expect(resolveDesktopTelemetryRoute("/workflows/run-1")).toBe("workflows");
    expect(resolveDesktopTelemetryRoute("/automations")).toBe("workflows");
    expect(resolveDesktopTelemetryRoute("/automations/run-1")).toBe("workflows");
  });

  it("falls back to unknown for unclassified routes", () => {
    expect(resolveDesktopTelemetryRoute("/workspace")).toBe("unknown");
  });
});
