import { describe, expect, it } from "vitest";
import { resolveHighlightTheme } from "./use-highlighted-code";

describe("resolveHighlightTheme", () => {
  it("maps resolved modes to explicit Shiki themes", () => {
    expect(resolveHighlightTheme("light")).toBe("light");
    expect(resolveHighlightTheme("dark")).toBe("dark");
    expect(resolveHighlightTheme("system")).toBe("dark");
  });
});
