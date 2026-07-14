import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchServerCapabilities } from "./server-capabilities";

describe("fetchServerCapabilities", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches capabilities from the exact supplied deployment", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        capabilities: {
          contractVersion: 1,
          deployment: {
            mode: "self_managed",
            displayName: "Qualification",
            logoUrl: null,
          },
          billing: false,
          usageMetering: false,
          cloudWorkspaces: false,
          agentGateway: false,
          webApp: { available: true, baseUrl: "https://app.example.test" },
          support: { kind: "operator", email: "ops@example.test", url: null },
          pricing: { available: false, url: null },
        },
      }),
    } as Response));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchServerCapabilities("https://self-hosted.example.test/root/"),
    ).resolves.toMatchObject({
      contractVersion: 1,
      deployment: {
        mode: "self_managed",
        displayName: "Qualification",
      },
      webApp: {
        available: true,
        baseUrl: "https://app.example.test",
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://self-hosted.example.test/root/meta",
      expect.objectContaining({
        headers: { Accept: "application/json" },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("degrades conservatively when the supplied deployment is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("unreachable");
    }));

    await expect(
      fetchServerCapabilities("https://offline.example.test"),
    ).resolves.toBeNull();
  });
});
