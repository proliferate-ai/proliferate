import { describe, expect, it } from "vitest";
import { selectConnectorIconTileClass } from "./connector-icon-tile";

describe("selectConnectorIconTileClass", () => {
  it("keeps the white brand tile by default in light mode", () => {
    expect(selectConnectorIconTileClass({}, "light")).toBe("bg-brand-logo-tile");
  });

  it("uses a transparent tile by default in dark mode", () => {
    expect(selectConnectorIconTileClass({}, "dark")).toBe("bg-transparent");
  });

  it("honors an explicit dark mode override", () => {
    expect(selectConnectorIconTileClass({ darkTileClassName: "bg-background" }, "dark")).toBe("bg-background");
  });
});
