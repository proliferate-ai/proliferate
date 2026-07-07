import { describe, expect, it } from "vitest";
import { splitProviderDisplayName } from "@/lib/domain/chat/models/model-display-name-parts";

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

  it("passes through plain model names", () => {
    expect(splitProviderDisplayName("GPT 5.5")).toEqual({
      leaf: "GPT 5.5",
      badge: null,
    });
  });

  it("passes through empty string", () => {
    expect(splitProviderDisplayName("")).toEqual({
      leaf: "",
      badge: null,
    });
  });
});
