import { describe, expect, it } from "vitest";

import { scrubTelemetryData, scrubTelemetryText, scrubTelemetryUrl } from "./scrub";

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
