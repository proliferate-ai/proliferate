import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDesktopReleaseManifest } from "@/lib/access/downloads/desktop-release-manifest";

describe("desktop release manifest access", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("encodes the installed version as one immutable path segment", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ version: "0.3.25+arm-test" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchDesktopReleaseManifest("0.3.25+arm-test");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://downloads.proliferate.com/desktop/stable/0.3.25%2Barm-test/latest.json",
      {
        method: "GET",
        headers: { Accept: "application/json" },
      },
    );
  });

  it("rejects non-success responses without parsing their body", async () => {
    const json = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, json })));

    await expect(fetchDesktopReleaseManifest("0.3.25"))
      .rejects.toThrow("Desktop release manifest request failed (404)");
    expect(json).not.toHaveBeenCalled();
  });
});
