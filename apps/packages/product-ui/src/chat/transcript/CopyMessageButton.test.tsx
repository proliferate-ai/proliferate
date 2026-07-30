import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CopyMessageButton } from "./CopyMessageButton";

describe("CopyMessageButton", () => {
  it("gives the button enough square clearance to avoid clipping the glyph", () => {
    const html = renderToStaticMarkup(
      <CopyMessageButton content="Answer" visibilityClassName="opacity-100" />,
    );

    expect(html).toContain("!size-icon-button-sm !p-0");
  });

  it("sizes the glyph to our 16px/13px (icon-paired) ratio, not icon-control", () => {
    // The "Copy message" button renders a 16px glyph against our chat font
    // size of 13px — 1.230769em, which is --icon-paired. --icon-control
    // (1.333333em) is visibly larger and was the round-2 regression this
    // guards against.
    const html = renderToStaticMarkup(
      <CopyMessageButton content="Answer" visibilityClassName="opacity-100" />,
    );

    expect(html).toContain("icon-paired");
    expect(html).not.toContain("icon-control");
  });

  it("uses the tertiary foreground tone at rest, matching the adjacent date", () => {
    const html = renderToStaticMarkup(
      <CopyMessageButton content="Answer" visibilityClassName="opacity-100" />,
    );

    expect(html).toContain("!text-foreground-tertiary");
  });
});
