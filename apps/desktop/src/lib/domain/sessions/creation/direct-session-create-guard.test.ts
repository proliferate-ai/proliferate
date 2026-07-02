import { describe, expect, it } from "vitest";
import {
  assertDirectSessionCreateSupported,
} from "@/lib/domain/sessions/creation/direct-session-create-guard";

describe("assertDirectSessionCreateSupported", () => {
  it("allows local direct session creation", () => {
    expect(() => assertDirectSessionCreateSupported({
      anyharnessWorkspaceId: "workspace-1",
      baseUrl: "http://localhost:6174",
      location: "local",
      runtimeGeneration: 0,
    })).not.toThrow();
  });

  it("allows cloud sandbox gateway session creation", () => {
    expect(() => assertDirectSessionCreateSupported({
      anyharnessWorkspaceId: "sandbox-workspace-1",
      baseUrl: "http://api.local/v1/gateway/cloud-sandbox/anyharness",
      location: "cloud",
      runtimeGeneration: 1,
      runtimeAccessKind: "proliferate-gateway",
      authToken: "product-token",
    })).not.toThrow();
  });

  it("fails closed for direct remote session creation", () => {
    expect(() => assertDirectSessionCreateSupported({
      anyharnessWorkspaceId: "workspace-1",
      baseUrl: "https://runtime.example.test",
      location: "cloud",
      runtimeGeneration: 1,
      authToken: "token",
    })).toThrow(/managed cloud gateway/i);
  });
});
