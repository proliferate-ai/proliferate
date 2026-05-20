import { describe, expect, it } from "vitest";

import { scrubTelemetryData, scrubTelemetryText } from "./scrub";

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
