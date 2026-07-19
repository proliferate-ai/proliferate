import { describe, expect, it } from "vitest";

import {
  buildRenderErrorTechnicalDetails,
  formatRenderErrorDetails,
  parseRenderErrorReleaseIdentity,
  sanitizeRenderErrorText,
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
    expect(details.message).toBe("Unexpected render error");
    expect(details.componentStack).toBe("Unavailable");
  });

  it.each([
    [
      "inline prompt",
      "Render failed; prompt=ship the quiet acquisition",
      "ship the quiet acquisition",
    ],
    [
      "quoted prompt",
      "Failure context: prompt was 'buy Northwind quietly'",
      "buy Northwind quietly",
    ],
    [
      "inline transcript",
      "transcript: customer named the embargo date",
      "customer named the embargo date",
    ],
    [
      "quoted transcript",
      "{\"transcript\":\"private customer words\"}",
      "private customer words",
    ],
    ["short credential", "Request failed with token=x7", "x7"],
    ["quoted credential", "authorization: 'ok'", "ok"],
    ["camel-case credential", "{\"refreshToken\":\"r2\"}", "r2"],
    [
      "query secret",
      "Fetch https://api.example.test/jobs?client_secret=z9&view=full failed",
      "z9",
    ],
    [
      "URL credentials",
      "Fetch https://alice:p4@example.test/jobs failed",
      "p4",
    ],
    [
      "general POSIX path",
      "Module failed at /opt/acme/internal/App.tsx:4:2",
      "/opt/acme/internal/App.tsx",
    ],
    ["UNC path", "Module failed at \\\\corp-server\\private-share\\App.tsx", "corp-server"],
    ["Windows path", "Module failed at D:\\Clients\\Private\\App.tsx", "Clients"],
  ])("fails closed for %s material", (_name, value, privateValue) => {
    const sanitized = sanitizeRenderErrorText(
      value,
      "Unexpected render error",
      1_000,
    );

    expect(sanitized).toBe("Unexpected render error");
    expect(sanitized).not.toContain(privateValue);
  });

  it("preserves ordinary error messages and relative component stacks", () => {
    expect(
      sanitizeRenderErrorText(
        "Cannot read properties of undefined (reading 'map')",
        "Unexpected render error",
        1_000,
      ),
    ).toBe("Cannot read properties of undefined (reading 'map')");
    expect(
      sanitizeRenderErrorText(
        "at WorkspacePane (WorkspacePane.tsx:41:9)\nat renderWithHooks (react-dom.js:120:4)",
        "Unavailable",
        8_000,
      ),
    ).toBe(
      "at WorkspacePane (WorkspacePane.tsx:41:9)\nat renderWithHooks (react-dom.js:120:4)",
    );
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
