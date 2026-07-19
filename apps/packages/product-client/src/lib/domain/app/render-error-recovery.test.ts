import { describe, expect, it } from "vitest";

import {
  buildRenderErrorTechnicalDetails,
  formatRenderErrorDetails,
  parseRenderErrorReleaseIdentity,
} from "#product/lib/domain/app/render-error-recovery";

describe("render error recovery privacy projection", () => {
  it("excludes prompt, transcript, credential, and private path content", () => {
    const privateValues = {
      prompt: "design the unreleased acquisition plan",
      transcript: "customer said the private launch date",
      token: "private-token-fixture-value",
      path: "/Users/pablohansen/Secret Client/project/App.tsx:41:9",
    };
    const details = buildRenderErrorTechnicalDetails({
      error: new Error(
        `prompt=${privateValues.prompt}\ntranscript: ${privateValues.transcript}\nBearer ${privateValues.token}\nFailed at ${privateValues.path}`,
      ),
      componentStack: `at PrivatePane (${privateValues.path})`,
      clientReleaseId: "proliferate-desktop@1.4.2+abcdef123456",
    });
    const serialized = formatRenderErrorDetails(details, "failed");

    for (const privateValue of Object.values(privateValues)) {
      expect(serialized).not.toContain(privateValue);
    }
    expect(serialized).toContain("prompt=[redacted]");
    expect(serialized).toContain("transcript=[redacted]");
    expect(serialized).toContain("[private path]");
  });

  it("splits the canonical release into app, version, release, and build", () => {
    expect(
      parseRenderErrorReleaseIdentity(
        "proliferate-desktop@1.4.2+abcdef123456",
      ),
    ).toEqual({
      app: "proliferate-desktop",
      version: "1.4.2",
      release: "proliferate-desktop@1.4.2+abcdef123456",
      build: "abcdef123456",
    });
  });

  it("fails closed for a malformed release identity", () => {
    expect(parseRenderErrorReleaseIdentity("release from /Users/private"))
      .toEqual({
        app: "Unavailable",
        version: "Unavailable",
        release: "Unavailable",
        build: "Unavailable",
      });
  });
});
