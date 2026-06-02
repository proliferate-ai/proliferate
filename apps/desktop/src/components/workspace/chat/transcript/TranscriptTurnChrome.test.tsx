// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TurnShell } from "./TranscriptTurnChrome";

afterEach(() => {
  cleanup();
});

describe("TurnShell", () => {
  it("keeps normal completed rows roomy", () => {
    const { container } = render(
      <TurnShell>
        <div>row</div>
      </TurnShell>,
    );

    expect(container.innerHTML).toContain("pt-2");
    expect(container.innerHTML).toContain("pb-2");
  });

  it("uses compact padding for active iteration rows", () => {
    const { container } = render(
      <TurnShell density="compact">
        <div>row</div>
      </TurnShell>,
    );

    expect(container.innerHTML).toContain("pt-1");
    expect(container.innerHTML).toContain("pb-1");
  });
});
