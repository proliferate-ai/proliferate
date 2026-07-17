import { describe, expect, it } from "vitest";

import { resolveWebApiBaseUrl } from "./env";

describe("resolveWebApiBaseUrl", () => {
  it("uses an explicit VITE_PROLIFERATE_API_BASE_URL even in a production browser", () => {
    // Managed Vercel builds bake their managed API origin; it must win over
    // same-origin resolution regardless of the current browser origin.
    expect(
      resolveWebApiBaseUrl({
        explicit: "https://app.proliferate.com",
        isProd: true,
        origin: "https://managed-web.proliferate.com",
      }),
    ).toBe("https://app.proliferate.com");
  });

  it("uses the explicit value in local development too", () => {
    expect(
      resolveWebApiBaseUrl({
        explicit: "https://staging.proliferate.com",
        isProd: false,
        origin: null,
      }),
    ).toBe("https://staging.proliferate.com");
  });

  it("falls back to window.location.origin for a production build without an explicit value", () => {
    // The self-hosted case: Web is served from the same server image and public
    // URL as its API, so the same origin is the correct API base.
    expect(
      resolveWebApiBaseUrl({
        explicit: undefined,
        isProd: true,
        origin: "https://proliferate.company.com",
      }),
    ).toBe("https://proliferate.company.com");
  });

  it("keeps the localhost:8000 default in local development without an explicit value", () => {
    expect(
      resolveWebApiBaseUrl({ explicit: undefined, isProd: false, origin: null }),
    ).toBe("http://localhost:8000");
  });

  it("treats a blank explicit value as unset", () => {
    expect(
      resolveWebApiBaseUrl({ explicit: "   ", isProd: false, origin: null }),
    ).toBe("http://localhost:8000");
  });

  it("normalizes a trailing slash on the explicit value", () => {
    expect(
      resolveWebApiBaseUrl({
        explicit: "https://app.proliferate.com/",
        isProd: true,
        origin: null,
      }),
    ).toBe("https://app.proliferate.com");
  });

  it("normalizes a trailing slash on the same-origin fallback", () => {
    expect(
      resolveWebApiBaseUrl({
        explicit: undefined,
        isProd: true,
        origin: "https://proliferate.company.com/",
      }),
    ).toBe("https://proliferate.company.com");
  });

  it("falls back to the local dev default when a production build has no origin", () => {
    // Defensive: a production build outside a browser (no window) should not
    // crash; it degrades to the local dev default rather than an empty origin.
    expect(
      resolveWebApiBaseUrl({ explicit: undefined, isProd: true, origin: null }),
    ).toBe("http://localhost:8000");
  });
});
