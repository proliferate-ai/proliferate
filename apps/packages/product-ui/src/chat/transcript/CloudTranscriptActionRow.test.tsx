// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CloudTranscriptActionRow } from "./CloudTranscriptActionRow";

afterEach(cleanup);

describe("CloudTranscriptActionRow", () => {
  it("uses persistent 16px activity icons and a separate hover disclosure", () => {
    const { container } = render(
      <CloudTranscriptActionRow
        icon={<svg aria-label="Tool icon" />}
        label="Read file"
        hint="src/app.ts"
        status="completed"
      >
        <div>Details</div>
      </CloudTranscriptActionRow>,
    );

    const disclosure = screen.getByRole("button", { name: /Read file/ });
    expect(disclosure.className).toContain("text-foreground/60");
    expect(disclosure.className).toContain("gap-1");

    const icons = disclosure.querySelectorAll("svg");
    expect(icons).toHaveLength(2);
    expect(icons[0]?.parentElement?.className).toContain("[&_svg]:size-4");
    expect(icons[1]?.classList.contains("size-3.5")).toBe(true);
    expect(icons[1]?.classList.contains("opacity-0")).toBe(true);

    const hint = container.querySelector<HTMLElement>("[title='src/app.ts']");
    expect(hint?.classList.contains("font-mono")).toBe(true);
    expect(hint?.className).not.toContain("border");
    expect(hint?.className).not.toContain("bg-muted");

    fireEvent.click(disclosure);
    expect(screen.getByText("Details")).toBeTruthy();
    expect(icons[1]?.classList.contains("rotate-90")).toBe(true);
  });
});
