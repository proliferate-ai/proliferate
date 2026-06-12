import { describe, expect, it } from "vitest";
import {
  decideModelGate,
  gateModelList,
  unlockHintForContexts,
  type GateableModel,
  type ModelAvailability,
} from "./model-availability";

function availability(...anyOf: string[]): ModelAvailability {
  return { anyOf };
}

describe("decideModelGate", () => {
  it("enables a model when anyOf intersects the active contexts", () => {
    expect(
      decideModelGate(
        availability("anthropic-oauth", "anthropic-api"),
        ["baseline", "anthropic-api"],
      ),
    ).toEqual({ state: "enabled" });
  });

  it("counts baseline like any other context when active", () => {
    expect(decideModelGate(availability("baseline"), ["baseline"]))
      .toEqual({ state: "enabled" });
  });

  it("gates a baseline-only model when baseline is not active", () => {
    expect(decideModelGate(availability("baseline"), ["anthropic-api"])).toEqual({
      state: "gated",
      unlockContexts: ["baseline"],
      unlockHint: "available without credentials",
    });
  });

  it("gates a model outside the known contexts with anyOf as the unlock set", () => {
    expect(
      decideModelGate(
        availability("anthropic-oauth", "anthropic-api"),
        ["baseline", "openai-api"],
      ),
    ).toEqual({
      state: "gated",
      unlockContexts: ["anthropic-oauth", "anthropic-api"],
      unlockHint: "sign in with Claude or add an Anthropic API key",
    });
  });

  it("gates with a multi-unlock hint preserving anyOf order", () => {
    const decision = decideModelGate(
      availability("anthropic-bedrock", "anthropic-oauth", "anthropic-api"),
      [],
    );
    expect(decision).toEqual({
      state: "gated",
      unlockContexts: ["anthropic-bedrock", "anthropic-oauth", "anthropic-api"],
      unlockHint:
        "configure AWS Bedrock or sign in with Claude or add an Anthropic API key",
    });
  });

  it("falls back to a readable hint for unknown context ids", () => {
    expect(decideModelGate(availability("mistral_api-key"), ["baseline"])).toEqual({
      state: "gated",
      unlockContexts: ["mistral_api-key"],
      unlockHint: "set up mistral api key",
    });
  });

  it("dedupes repeated unlock contexts", () => {
    expect(
      decideModelGate(availability("openai-oauth", "openai-oauth"), []),
    ).toEqual({
      state: "gated",
      unlockContexts: ["openai-oauth"],
      unlockHint: "sign in with ChatGPT/Codex",
    });
  });

  it("treats missing availability as enabled (no unknown-state UI)", () => {
    expect(decideModelGate(null, [])).toEqual({ state: "enabled" });
    expect(decideModelGate(undefined, [])).toEqual({ state: "enabled" });
    expect(decideModelGate(availability(), [])).toEqual({ state: "enabled" });
  });
});

describe("unlockHintForContexts", () => {
  it("maps every known context id to its phrase", () => {
    expect(unlockHintForContexts(["anthropic-api"])).toBe("add an Anthropic API key");
    expect(unlockHintForContexts(["anthropic-oauth"])).toBe("sign in with Claude");
    expect(unlockHintForContexts(["anthropic-bedrock"])).toBe("configure AWS Bedrock");
    expect(unlockHintForContexts(["openai-api"])).toBe("add an OpenAI API key");
    expect(unlockHintForContexts(["openai-oauth"])).toBe("sign in with ChatGPT/Codex");
    expect(unlockHintForContexts(["gemini-api"])).toBe("add a Gemini API key");
    expect(unlockHintForContexts(["google-oauth"])).toBe("sign in with Google");
    expect(unlockHintForContexts(["cursor-login"])).toBe("sign in to Cursor");
    expect(unlockHintForContexts(["baseline"])).toBe("available without credentials");
  });

  it("joins multiple phrases with ' or '", () => {
    expect(unlockHintForContexts(["google-oauth", "gemini-api"]))
      .toBe("sign in with Google or add a Gemini API key");
  });

  it("composes known and unknown ids", () => {
    expect(unlockHintForContexts(["cursor-login", "acme-sso"]))
      .toBe("sign in to Cursor or set up acme sso");
  });
});

describe("gateModelList", () => {
  const models: (GateableModel & { extra?: string })[] = [
    { id: "opus-4-8", displayName: "Opus 4.8", availability: availability("anthropic-oauth", "anthropic-api") },
    { id: "sonnet-4-5", displayName: "Sonnet 4.5", availability: availability("baseline"), extra: "kept" },
    { id: "gpt-5.2-codex", displayName: "GPT-5.2 Codex", availability: availability("openai-oauth") },
    { id: "mystery", displayName: "Mystery" },
  ];

  it("returns every model with a decision — the menu never shrinks", () => {
    const gated = gateModelList(models, ["baseline"]);

    expect(gated.map((model) => model.id)).toEqual([
      "opus-4-8",
      "sonnet-4-5",
      "gpt-5.2-codex",
      "mystery",
    ]);
    expect(gated.map((model) => model.decision.state)).toEqual([
      "gated",
      "enabled",
      "gated",
      "enabled",
    ]);
  });

  it("keeps extra model fields intact", () => {
    const gated = gateModelList(models, ["baseline"]);
    expect(gated[1].extra).toBe("kept");
  });

  it("annotates gated entries with unlock conditions from anyOf", () => {
    const gated = gateModelList(models, ["baseline"]);
    expect(gated[0].decision).toEqual({
      state: "gated",
      unlockContexts: ["anthropic-oauth", "anthropic-api"],
      unlockHint: "sign in with Claude or add an Anthropic API key",
    });
  });

  it("returns the full list even when no context is active", () => {
    expect(gateModelList(models, [])).toHaveLength(models.length);
  });
});
