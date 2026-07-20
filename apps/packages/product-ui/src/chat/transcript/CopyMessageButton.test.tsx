import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CopyMessageButton } from "./CopyMessageButton";

describe("CopyMessageButton", () => {
  it("gives the control glyph enough square clearance to avoid clipping", () => {
    const html = renderToStaticMarkup(
      <CopyMessageButton content="Answer" visibilityClassName="opacity-100" />,
    );

    expect(html).toContain("icon-control");
    expect(html).toContain("!size-6 !p-0");
  });
});
