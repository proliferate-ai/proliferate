import { describe, expect, it } from "vitest";
import {
  formatModelLeafName,
  splitProviderDisplayName,
} from "@/lib/domain/chat/models/model-display-name-parts";

describe("splitProviderDisplayName", () => {
  it("splits on the first slash", () => {
    expect(splitProviderDisplayName("OpenCode Zen/Claude Sonnet 4")).toEqual({
      leaf: "Claude Sonnet 4",
      badge: "OpenCode Zen",
    });
  });

  it("splits on the first slash when multiple slashes exist", () => {
    expect(splitProviderDisplayName("Acme/Pro/Turbo")).toEqual({
      leaf: "Pro/Turbo",
      badge: "Acme",
    });
  });

  it("trims whitespace around both parts", () => {
    expect(splitProviderDisplayName(" OpenCode Zen / DeepSeek V4 Flash Free ")).toEqual({
      leaf: "DeepSeek V4 Flash Free",
      badge: "OpenCode Zen",
    });
  });

  it("returns null badge when no slash is present", () => {
    expect(splitProviderDisplayName("Sonnet 4.5")).toEqual({
      leaf: "Sonnet 4.5",
      badge: null,
    });
  });

  it("returns null badge when prefix is empty", () => {
    expect(splitProviderDisplayName("/Claude Sonnet 4")).toEqual({
      leaf: "/Claude Sonnet 4",
      badge: null,
    });
  });

  it("returns null badge when suffix is empty", () => {
    expect(splitProviderDisplayName("OpenCode Zen/")).toEqual({
      leaf: "OpenCode Zen/",
      badge: null,
    });
  });

  it("returns null badge when suffix is only whitespace", () => {
    expect(splitProviderDisplayName("OpenCode Zen/   ")).toEqual({
      leaf: "OpenCode Zen/   ",
      badge: null,
    });
  });

  it("drops the GPT prefix from plain model names", () => {
    expect(splitProviderDisplayName("GPT 5.5")).toEqual({
      leaf: "5.5",
      badge: null,
    });
  });

  it("drops the GPT prefix from namespaced leaves", () => {
    expect(splitProviderDisplayName("OpenAI/GPT-5.6 Sol")).toEqual({
      leaf: "5.6 Sol",
      badge: "OpenAI",
    });
  });

  it("passes through empty string", () => {
    expect(splitProviderDisplayName("")).toEqual({
      leaf: "",
      badge: null,
    });
  });
});

describe("formatModelLeafName", () => {
  it("strips GPT- and title-cases variant words", () => {
    expect(formatModelLeafName("GPT-5.6 Sol")).toBe("5.6 Sol");
    expect(formatModelLeafName("gpt-5.6-sol")).toBe("5.6 Sol");
    expect(formatModelLeafName("gpt-5.4-mini")).toBe("5.4 Mini");
    expect(formatModelLeafName("GPT-5.5")).toBe("5.5");
  });

  it("leaves non-GPT names untouched", () => {
    expect(formatModelLeafName("Sonnet 4.5")).toBe("Sonnet 4.5");
    expect(formatModelLeafName("Claude Opus 4.8")).toBe("Claude Opus 4.8");
    expect(formatModelLeafName("grok-4.3")).toBe("grok-4.3");
    expect(formatModelLeafName("chatgpt-image-latest")).toBe("chatgpt-image-latest");
  });
});
