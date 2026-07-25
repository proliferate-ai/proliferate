// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GoalTranscriptEventRow } from "./GoalTranscriptEventRow";

afterEach(cleanup);

describe("GoalTranscriptEventRow", () => {
  it("constrains long user-initiated goal chips to the transcript column", () => {
    render(
      <GoalTranscriptEventRow
        event={{
          id: "goal-set-1",
          seq: 1,
          turnId: "turn-1",
          kind: "set",
          objective: "A long objective that must truncate instead of overflowing a narrow transcript column",
          detail: null,
        }}
      />,
    );

    const chip = screen.getByRole("button");
    expect(chip.classList.contains("max-w-full")).toBe(true);
    expect(chip.classList.contains("min-w-0")).toBe(true);
    const label = chip.querySelector("span");
    expect(label?.classList.contains("min-w-0")).toBe(true);
    expect(label?.classList.contains("truncate")).toBe(true);
  });
});
