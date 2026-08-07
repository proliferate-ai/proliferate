import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("browser-router navigation priority", () => {
  it.each([
    ["Desktop", new URL("../../../../desktop/src/main.tsx", import.meta.url)],
    ["Web", new URL("../../../../web/src/WebHostApp.tsx", import.meta.url)],
  ])("keeps the %s host on the urgent router policy", (_host, sourceUrl) => {
    const source = readFileSync(sourceUrl, "utf8");

    expect(source).toMatch(/<BrowserRouter\s+useTransitions=\{false\}>/);
  });
});
