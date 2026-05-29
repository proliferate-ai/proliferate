import { describe, expect, it } from "vitest";
import type { SessionLiveConfigSnapshot } from "@anyharness/sdk";
import { resolveFallbackSessionModelId } from "./model-fallback";

const LIVE_CONFIG: SessionLiveConfigSnapshot = {
  rawConfigOptions: [],
  normalizedControls: {
    model: {
      key: "model",
      rawConfigId: "model",
      label: "Model",
      currentValue: "opus[1m]",
      settable: true,
      values: [
        { value: "opus[1m]", label: "Opus 4.7" },
        { value: "claude-opus-4-6", label: "Opus 4.6" },
      ],
    },
    collaborationMode: null,
    mode: null,
    reasoning: null,
    effort: null,
    fastMode: null,
    extras: [],
  },
  sourceSeq: 10,
  updatedAt: "2026-04-28T00:00:00.000Z",
};

describe("resolveFallbackSessionModelId", () => {
  it("prefers a confirmed requested fallback over the old current response model", () => {
    expect(resolveFallbackSessionModelId({
      responseModelId: "opus[1m]",
      responseRequestedModelId: "claude-opus-4-6",
      liveConfig: LIVE_CONFIG,
      fallbackModelId: "claude-opus-4-6",
    })).toBe("claude-opus-4-6");
  });

  it("prefers the session response over stale live config", () => {
    expect(resolveFallbackSessionModelId({
      responseModelId: "claude-opus-4-6",
      responseRequestedModelId: null,
      liveConfig: LIVE_CONFIG,
      fallbackModelId: "claude-opus-4-6",
    })).toBe("claude-opus-4-6");
  });

  it("does not trust requested model when it does not match the fallback request", () => {
    expect(resolveFallbackSessionModelId({
      responseModelId: "opus[1m]",
      responseRequestedModelId: "claude-sonnet-4-5",
      liveConfig: LIVE_CONFIG,
      fallbackModelId: "claude-opus-4-6",
    })).toBe("opus[1m]");
  });

  it("falls back to live config when the response omits model id", () => {
    expect(resolveFallbackSessionModelId({
      responseModelId: null,
      responseRequestedModelId: null,
      liveConfig: LIVE_CONFIG,
      fallbackModelId: "claude-opus-4-6",
    })).toBe("opus[1m]");
  });

  it("falls back to the requested fallback model when no authoritative value exists", () => {
    expect(resolveFallbackSessionModelId({
      responseModelId: null,
      responseRequestedModelId: null,
      liveConfig: null,
      fallbackModelId: "claude-opus-4-6",
    })).toBe("claude-opus-4-6");
  });
});
