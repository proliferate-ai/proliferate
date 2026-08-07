import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const stylesheetPath = new URL("./authenticated.css", import.meta.url);

describe("authenticated workspace shell motion", () => {
  it("registers synchronized length variables and uses reduced-motion-aware roles", async () => {
    const stylesheet = await readFile(stylesheetPath, "utf8");

    expect(stylesheet).toContain("@property --workspace-left-width");
    expect(stylesheet).toContain("@property --workspace-right-width");
    expect(stylesheet).toContain("syntax: \"<length>\"");
    expect(stylesheet).toContain("transition-property: --workspace-left-width, --workspace-right-width");
    expect(stylesheet).toContain("var(--duration-panel)");
    expect(stylesheet).toContain("var(--ease-out-cubic)");
    expect(stylesheet).toContain("[data-snap-left-geometry=\"true\"]");
    expect(stylesheet).toContain("[data-snap-right-geometry=\"true\"]");
    expect(stylesheet).toContain("--workspace-right-geometry-duration: 0ms");
    expect(stylesheet).toContain("[data-manual-workspace-geometry=\"true\"]");
  });
});
