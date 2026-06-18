// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TurnShell, resolveTurnTrailingStatus } from "./TranscriptTurnChrome";

afterEach(() => {
  cleanup();
});

describe("resolveTurnTrailingStatus", () => {
  it("renders a muted, right-aligned 'You stopped after Ns' label when cancelled", () => {
    const { container } = render(
      <div>{resolveTurnTrailingStatus("2026-04-04T00:00:00Z", "idle", null, 12)}</div>,
    );

    expect(container.textContent).toContain("You stopped after 12s");
    expect(container.innerHTML).toContain("justify-end");
    expect(container.innerHTML).toContain("text-muted-foreground");
  });

  it("ignores the cancelled branch when no elapsed time is provided", () => {
    const { container } = render(
      <div>{resolveTurnTrailingStatus("2026-04-04T00:00:00Z", "idle", null)}</div>,
    );

    expect(container.textContent).not.toContain("You stopped after");
  });
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
