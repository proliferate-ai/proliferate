import { describe, expect, it } from "vitest";

import {
  scrubTelemetryData,
  scrubTelemetryEvent,
  scrubTelemetryText,
  scrubTelemetryUrl,
} from "./scrub";

describe("scrubTelemetryData", () => {
  it("redacts sensitive keys recursively", () => {
    expect(
      scrubTelemetryData({
        token: "abc",
        nested: {
          prompt: "write code",
          items: [{ file_path: "/Users/pablo/project/.env" }],
        },
      }),
    ).toEqual({
      token: "[redacted]",
      nested: {
        prompt: "[redacted]",
        items: [{ file_path: "[redacted]" }],
      },
    });
  });

  it("replaces cyclic object and array edges with a fixed marker", () => {
    const cyclicObject: Record<string, unknown> = { token: "secret" };
    cyclicObject.self = cyclicObject;
    const cyclicArray: unknown[] = [];
    cyclicArray.push(cyclicArray);

    expect(scrubTelemetryData(cyclicObject)).toEqual({
      token: "[redacted]",
      self: "[circular]",
    });
    expect(scrubTelemetryData(cyclicArray)).toEqual(["[circular]"]);
  });

  it("reuses a completed scrubbed value for repeated shared references", () => {
    const shared = {
      path: "/Users/pablo/private/file.ts",
      message: "Bearer secret-token",
    };
    const scrubbed = scrubTelemetryData({ first: shared, second: shared });

    expect(scrubbed).toEqual({
      first: { path: "[redacted]", message: "[redacted-token]" },
      second: { path: "[redacted]", message: "[redacted-token]" },
    });
    expect(scrubbed.first).toBe(scrubbed.second);
    expect(() => JSON.stringify(scrubbed)).not.toThrow();
  });

  it("truncates adversarially deep containers before recursion can overflow", () => {
    const payload: Record<string, unknown> = {};
    let cursor = payload;
    for (let index = 0; index < 20_000; index += 1) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }

    const scrubbed = scrubTelemetryData(payload);
    let nested: unknown = scrubbed;
    let scrubbedDepth = 0;
    while (nested !== null && typeof nested === "object") {
      nested = (nested as Record<string, unknown>).next;
      scrubbedDepth += 1;
    }

    expect(nested).toBe("[truncated]");
    expect(scrubbedDepth).toBeLessThan(20);
    expect(() => JSON.stringify(scrubbed)).not.toThrow();
  });

  it("bounds huge sparse arrays without retaining the source length", () => {
    const sparse: unknown[] = [];
    sparse.length = 1_000_000;
    sparse[0] = { token: "secret", message: "useful" };
    sparse[999_999] = "Bearer omitted-secret";

    const scrubbed = scrubTelemetryData(sparse);
    const serialized = JSON.stringify(scrubbed);

    expect(scrubbed.length).toBeLessThan(200);
    expect(scrubbed[0]).toEqual({ token: "[redacted]", message: "useful" });
    expect(scrubbed.at(-1)).toBe("[truncated]");
    expect(serialized.length).toBeLessThan(2_000);
    expect(serialized).not.toContain("omitted-secret");
  });

  it("bounds wide objects and does not evaluate omitted accessors", () => {
    let getterCalls = 0;
    const wide: Record<string, unknown> = {};
    for (let index = 0; index < 1_000; index += 1) {
      wide[`field_${index}`] = `value-${index}`;
    }
    Object.defineProperty(wide, "omitted", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return "Bearer should-not-be-read";
      },
    });

    const scrubbed = scrubTelemetryData(wide);

    expect(Object.keys(scrubbed).length).toBeLessThan(200);
    expect(scrubbed.field_0).toBe("value-0");
    expect(scrubbed["[truncated]"]).toBe("[truncated]");
    expect(scrubbed.omitted).toBeUndefined();
    expect(getterCalls).toBe(0);
    expect(JSON.stringify(scrubbed)).not.toContain("should-not-be-read");
  });

  it("does not evaluate enumerable getters while inspecting telemetry", () => {
    let getterCalls = 0;
    const payload = { safe: "value" } as Record<string, unknown>;
    Object.defineProperty(payload, "constructor", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return "Bearer should-not-be-read";
      },
    });

    expect(scrubTelemetryData(payload)).toEqual({
      safe: "value",
      constructor: "[redacted]",
    });
    expect(getterCalls).toBe(0);
  });

  it("scrubs bearer tokens, jwt values, and absolute paths from strings", () => {
    expect(
      scrubTelemetryText(
        "Bearer abc.DEF-123 token eyJabc.def.ghi at /Users/pablo/private/file.ts",
      ),
    ).toBe("[redacted-token] token [redacted-jwt] at [redacted-path]");
  });

  it("strips query strings and fragments from URLs", () => {
    expect(
      scrubTelemetryUrl("https://app.proliferate.com/auth/callback?code=abc&state=def#done"),
    ).toBe("https://app.proliferate.com/auth/callback");
    expect(
      scrubTelemetryUrl("proliferate://auth/callback?code=abc&state=def"),
    ).toBe("proliferate://auth/callback");
    expect(scrubTelemetryUrl("/auth/callback?code=abc&state=def")).toBe("/auth/callback");
  });

  it("strips query strings from URL-like text", () => {
    expect(
      scrubTelemetryText(
        "GET https://app.proliferate.com/auth/callback?code=abc&state=def failed",
      ),
    ).toBe("GET https://app.proliferate.com/auth/callback failed");
    expect(scrubTelemetryText("opened /auth/callback?code=abc&state=def")).toBe(
      "opened /auth/callback",
    );
  });

  it("redacts mobile sandbox and Windows paths", () => {
    expect(
      scrubTelemetryText(
        "ios /private/var/mobile/Containers/Data/app/file android /data/user/0/app/file win C:/Users/pablo/app/file",
      ),
    ).toBe("ios [redacted-path] android [redacted-path] win [redacted-path]");
  });

  it("preserves the top-level deployment environment while redacting nested env data", () => {
    expect(
      scrubTelemetryEvent({
        environment: "production",
        tags: { environment: "prod", runtime_env: "e2b" },
        contexts: { app: { env: { SECRET: "x" } } },
      }),
    ).toEqual({
      environment: "production",
      // Nested `environment`/`env`/`runtime_env` keys all match the sensitive
      // key pattern and stay redacted; only the top-level string survives.
      tags: { environment: "[redacted]", runtime_env: "[redacted]" },
      contexts: { app: { env: "[redacted]" } },
    });
  });

  it("scrubs the preserved top-level environment string as text", () => {
    expect(
      scrubTelemetryEvent({ environment: "Bearer secret /Users/pablo/app" }).environment,
    ).toBe("[redacted-token] [redacted-path]");
  });

  it("can preserve PostHog internal envelope keys while scrubbing user data", () => {
    expect(
      scrubTelemetryData(
        {
          token: "posthog-project-token",
          distinct_id: "user-123",
          properties: {
            api_key: "secret",
            path: "/home/pablo/project",
          },
          $set: {
            email: "person@example.com",
          },
        },
        { preservePostHogInternalKeys: true },
      ),
    ).toEqual({
      token: "posthog-project-token",
      distinct_id: "user-123",
      properties: {
        api_key: "[redacted]",
        path: "[redacted]",
      },
      $set: {
        email: "person@example.com",
      },
    });
  });
});
