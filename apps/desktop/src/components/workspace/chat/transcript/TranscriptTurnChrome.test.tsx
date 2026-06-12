// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TurnShell } from "./TranscriptTurnChrome";

afterEach(() => {
  cleanup();
});

describe("TurnShell", () => {
  it("uses one vertical rhythm for every row", () => {
    const { container } = render(
      <TurnShell>
        <div>row</div>
      </TurnShell>,
    );

    expect(container.innerHTML).toContain("pt-2");
    expect(container.innerHTML).toContain("pb-2");
  });

  it("drops top padding on the first row only", () => {
    const { container } = render(
      <TurnShell isFirst>
        <div>row</div>
      </TurnShell>,
    );

    expect(container.innerHTML).toContain("pt-0");
    expect(container.innerHTML).toContain("pb-2");
  });
});
