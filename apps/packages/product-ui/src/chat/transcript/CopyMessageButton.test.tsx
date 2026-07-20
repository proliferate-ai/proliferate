import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CopyMessageButton } from "./CopyMessageButton";

describe("CopyMessageButton", () => {
  it("uses the larger control glyph without changing the compact hit target", () => {
    const html = renderToStaticMarkup(
      <CopyMessageButton content="Answer" visibilityClassName="opacity-100" />,
    );

    expect(html).toContain("icon-control");
    expect(html).toContain("size-5 p-0");
  });
});
