import { describe, expect, it } from "vitest";
import { buildAnyHarnessCacheScopeKey } from "./anyharness-cache-scope";

describe("buildAnyHarnessCacheScopeKey", () => {
  it("isolates authenticated actors on the same deployment", () => {
    const first = buildAnyHarnessCacheScopeKey({
      apiBaseUrl: "https://api.proliferate.com",
      authStatus: "authenticated",
      authUserId: "user-1",
    });
    const second = buildAnyHarnessCacheScopeKey({
      apiBaseUrl: "https://api.proliferate.com",
      authStatus: "authenticated",
      authUserId: "user-2",
    });

    expect(first).not.toBe(second);
  });

  it("isolates the same actor across deployments", () => {
    const hosted = buildAnyHarnessCacheScopeKey({
      apiBaseUrl: "https://api.proliferate.com",
      authStatus: "authenticated",
      authUserId: "user-1",
    });
    const selfHosted = buildAnyHarnessCacheScopeKey({
      apiBaseUrl: "https://proliferate.example.com",
      authStatus: "authenticated",
      authUserId: "user-1",
    });

    expect(hosted).not.toBe(selfHosted);
  });

  it("isolates path-based deployments on the same origin", () => {
    const first = buildAnyHarnessCacheScopeKey({
      apiBaseUrl: "https://proliferate.example.com/instance-a",
      authStatus: "authenticated",
      authUserId: "user-1",
    });
    const second = buildAnyHarnessCacheScopeKey({
      apiBaseUrl: "https://proliferate.example.com/instance-b",
      authStatus: "authenticated",
      authUserId: "user-1",
    });

    expect(first).not.toBe(second);
  });

  it("keeps anonymous and bootstrapping caches separate", () => {
    const anonymous = buildAnyHarnessCacheScopeKey({
      apiBaseUrl: "https://api.proliferate.com",
      authStatus: "anonymous",
      authUserId: null,
    });
    const bootstrapping = buildAnyHarnessCacheScopeKey({
      apiBaseUrl: "https://api.proliferate.com",
      authStatus: "bootstrapping",
      authUserId: null,
    });

    expect(anonymous).not.toBe(bootstrapping);
  });
});
