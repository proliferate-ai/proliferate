import { describe, expect, it } from "vitest";
import { isSetupHintEnabled, toggleSetupHint } from "./setup-hints";

describe("setup hint helpers", () => {
  it("checks commands by trimmed line", () => {
    expect(isSetupHintEnabled(" pnpm install \n pnpm build", "pnpm install")).toBe(true);
    expect(isSetupHintEnabled("pnpm install", " pnpm install ")).toBe(true);
    expect(isSetupHintEnabled("pnpm install", "pnpm test")).toBe(false);
    expect(isSetupHintEnabled("pnpm install", "   ")).toBe(false);
  });

  it("adds commands idempotently and ignores blank commands", () => {
    expect(toggleSetupHint("", " pnpm install ", true)).toBe("pnpm install");
    expect(toggleSetupHint("pnpm install", "pnpm install", true)).toBe("pnpm install");
    expect(toggleSetupHint("pnpm install", "   ", true)).toBe("pnpm install");
  });

  it("removes matching trimmed lines without touching other commands", () => {
    expect(toggleSetupHint(
      "pnpm install\n  pnpm build  \npnpm test",
      "pnpm build",
      false,
    )).toBe("pnpm install\npnpm test");
    expect(toggleSetupHint("pnpm install", "   ", false)).toBe("pnpm install");
  });
});
