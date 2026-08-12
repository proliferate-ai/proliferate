import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Card } from "./Card";
import { CARD_ENTRY } from "#product/components/playground/library/entries/Card";

describe("card smoke", () => {
  it("paints the tint surface and the double-layer sticky header", () => {
    const html = renderToStaticMarkup(
      <Card header={<span>H</span>} footer={<span>F</span>} stickyHeader>
        <span>B</span>
      </Card>,
    );
    expect(html).toContain("overflow-clip rounded-lg bg-surface-elevated-secondary");
    expect(html).toContain("sticky top-0 z-sticky bg-background");
    expect(html).toContain('<div class="bg-surface-elevated-secondary"><span>H</span></div>');
    expect(html).toContain('<div class="border-t border-border"><span>F</span></div>');
  });

  it("grounds a rail sticky header on the rail plane and an opaque card on itself", () => {
    expect(
      renderToStaticMarkup(<Card header={<span>H</span>} stickyHeader plane="rail"><span>B</span></Card>),
    ).toContain("z-sticky bg-sidebar");
    const opaque = renderToStaticMarkup(
      <Card header={<span>H</span>} stickyHeader surface="opaque" as="section"><span>B</span></Card>,
    );
    expect(opaque).toContain("<section");
    expect(opaque).toContain("border border-border bg-card");
    expect(opaque).toContain("z-sticky bg-card");
  });

  it("renders no header layer without a header slot", () => {
    const html = renderToStaticMarkup(<Card stickyHeader><span>B</span></Card>);
    expect(html).not.toContain("sticky");
    expect(html).not.toContain("border-b");
  });

  it("renders the registry demo", () => {
    expect(renderToStaticMarkup(<>{CARD_ENTRY.render()}</>)).toContain("Opaque panel");
  });
});
