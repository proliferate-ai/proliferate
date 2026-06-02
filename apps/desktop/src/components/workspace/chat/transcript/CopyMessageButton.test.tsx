// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CopyMessageButton } from "./CopyMessageButton";

afterEach(() => {
  cleanup();
});

describe("CopyMessageButton", () => {

  it("renders the timestamp before the copy button by default", () => {
    const { container } = render(
      <CopyMessageButton
        content="hello"
        timestampLabel="9:41 AM"
        visibilityClassName=""
      />,
    );

    const root = container.firstElementChild;
    expect(root?.children[0]?.tagName).toBe("SPAN");
    expect(root?.children[0]?.textContent).toBe("9:41 AM");
    expect(root?.children[1]?.tagName).toBe("BUTTON");
  });

  it("can render the copy button before the timestamp", () => {
    const { container } = render(
      <CopyMessageButton
        content="hello"
        timestampLabel="9:41 AM"
        timestampPosition="after"
        visibilityClassName=""
      />,
    );

    const root = container.firstElementChild;
    expect(root?.children[0]?.tagName).toBe("BUTTON");
    expect(root?.children[1]?.tagName).toBe("SPAN");
    expect(root?.children[1]?.textContent).toBe("9:41 AM");
  });
});
