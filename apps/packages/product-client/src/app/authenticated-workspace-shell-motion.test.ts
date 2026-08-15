import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const stylesheetPath = new URL("./authenticated.css", import.meta.url);
const consumerPaths = [
  new URL(
    "../components/workspace/shell/sidebar/WorkspaceShellSidebar.tsx",
    import.meta.url,
  ),
  new URL(
    "../components/workspace/shell/screen/WorkspaceShellRightRail.tsx",
    import.meta.url,
  ),
  new URL(
    "../components/workspace/shell/topbar/GlobalHeader.tsx",
    import.meta.url,
  ),
];

describe("authenticated workspace shell motion", () => {
  it("keeps the geometry vars unregistered and snap-duration aware", async () => {
    const stylesheet = await readFile(stylesheetPath, "utf8");

    // Registering the vars as <length> makes WebKit apply page zoom to them
    // twice (once at the custom property, once at the consumer), rendering
    // the panes at width·zoom² under window zoom (PRO-166).
    expect(stylesheet).not.toContain("@property --workspace-left-width");
    expect(stylesheet).not.toContain("@property --workspace-right-width");

    expect(stylesheet).toContain("var(--duration-panel)");
    expect(stylesheet).toContain("[data-snap-left-geometry=\"true\"]");
    expect(stylesheet).toContain("[data-snap-right-geometry=\"true\"]");
    expect(stylesheet).toContain("--workspace-left-geometry-duration: 0ms");
    expect(stylesheet).toContain("--workspace-right-geometry-duration: 0ms");
  });

  it("eases each geometry consumer against the shared snap durations", async () => {
    for (const consumerPath of consumerPaths) {
      const source = await readFile(consumerPath, "utf8");
      expect(source).toMatch(
        /\[transition-duration:var\(--workspace-(left|right)-geometry-duration\)\]/,
      );
      expect(source).toContain("ease-out-cubic");
    }
  });
});
