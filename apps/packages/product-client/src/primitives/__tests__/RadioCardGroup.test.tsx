// @vitest-environment jsdom

import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RadioCardGroup, type RadioCardOption } from "#product/primitives/RadioCardGroup";

afterEach(cleanup);

type Letter = "a" | "b" | "c" | "d";

const options: readonly RadioCardOption<Letter>[] = [
  { value: "a", label: "A" },
  { value: "b", label: "B", disabled: true },
  { value: "c", label: "C" },
  { value: "d", label: "D" },
];

function ControlledGroup(props: {
  initialValue: Letter | null;
  options?: readonly RadioCardOption<Letter>[];
  orientation?: "horizontal" | "vertical";
}) {
  const [value, setValue] = useState<Letter | null>(props.initialValue);
  return (
    <RadioCardGroup
      value={value}
      options={props.options ?? options}
      onChange={setValue}
      orientation={props.orientation}
    />
  );
}

describe("RadioCardGroup roving tabindex", () => {
  it("gives the selected option tabIndex 0 and every other option -1", () => {
    render(<ControlledGroup initialValue="c" />);

    expect(screen.getByRole("radio", { name: "A" }).getAttribute("tabindex")).toBe("-1");
    expect(screen.getByRole("radio", { name: "C" }).getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("radio", { name: "D" }).getAttribute("tabindex")).toBe("-1");
    expect(screen.getByRole("radio", { name: "C" }).hasAttribute("data-selected")).toBe(true);
    expect(screen.getByRole("radio", { name: "A" }).hasAttribute("data-selected")).toBe(false);
  });

  it("falls back to the first enabled option when nothing is selected", () => {
    // "A" is disabled, so the fallback tab stop must skip to "B".
    const withFirstDisabled: readonly RadioCardOption<Letter>[] = [
      { value: "a", label: "A", disabled: true },
      { value: "b", label: "B" },
      { value: "c", label: "C" },
    ];
    render(<ControlledGroup initialValue={null} options={withFirstDisabled} />);

    expect(screen.getByRole("radio", { name: "B" }).getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("radio", { name: "A" }).getAttribute("tabindex")).toBe("-1");
    expect(screen.getByRole("radio", { name: "C" }).getAttribute("tabindex")).toBe("-1");
    // The fallback tab stop is not a selection: nothing is checked yet.
    expect(screen.getByRole("radio", { name: "B" }).getAttribute("aria-checked")).toBe("false");
  });

  it("falls back to the first enabled option when the selected value is disabled", () => {
    // A selected value can become disabled later; it can never be the tab
    // stop, or every option would end up at tabIndex -1.
    render(<ControlledGroup initialValue="b" />);

    expect(screen.getByRole("radio", { name: "A" }).getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("radio", { name: "B" }).getAttribute("tabindex")).toBe("-1");
    // The tab stop fell back to "A", but "B" is still the actual selection:
    // aria-checked must track `value`, not the fallback tab stop.
    expect(screen.getByRole("radio", { name: "B" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "A" }).getAttribute("aria-checked")).toBe("false");
  });

  it("makes every option untabbable, without crashing, when all options are disabled", () => {
    const allDisabled: readonly RadioCardOption<Letter>[] = [
      { value: "a", label: "A", disabled: true },
      { value: "b", label: "B", disabled: true },
    ];
    render(<ControlledGroup initialValue={null} options={allDisabled} />);

    expect(screen.getByRole("radio", { name: "A" }).getAttribute("tabindex")).toBe("-1");
    expect(screen.getByRole("radio", { name: "B" }).getAttribute("tabindex")).toBe("-1");
  });
});

describe("RadioCardGroup keyboard navigation (horizontal)", () => {
  it("moves selection and DOM focus together with ArrowRight, skipping disabled options", () => {
    render(<ControlledGroup initialValue="a" />);
    const optionA = screen.getByRole("radio", { name: "A" });
    const optionC = screen.getByRole("radio", { name: "C" });

    optionA.focus();
    // fireEvent returns false when the handler called preventDefault. Without
    // that, arrow keys would also scroll the page while changing selection.
    expect(fireEvent.keyDown(optionA, { key: "ArrowRight" })).toBe(false);

    // "B" is disabled, so ArrowRight from "A" must land on "C", not "B".
    expect(optionC.getAttribute("aria-checked")).toBe("true");
    expect(optionA.getAttribute("aria-checked")).toBe("false");
    expect(optionC.getAttribute("tabindex")).toBe("0");
    expect(optionA.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(optionC);
  });

  it("moves backward with ArrowLeft and wraps from the first to the last option", () => {
    render(<ControlledGroup initialValue="a" />);
    const optionA = screen.getByRole("radio", { name: "A" });
    const optionD = screen.getByRole("radio", { name: "D" });

    optionA.focus();
    fireEvent.keyDown(optionA, { key: "ArrowLeft" });

    expect(optionD.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(optionD);
  });

  it("wraps forward from the last option back to the first", () => {
    render(<ControlledGroup initialValue="d" />);
    const optionD = screen.getByRole("radio", { name: "D" });
    const optionA = screen.getByRole("radio", { name: "A" });

    optionD.focus();
    fireEvent.keyDown(optionD, { key: "ArrowRight" });

    expect(optionA.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(optionA);
  });

  it("jumps to the first and last enabled options with Home and End", () => {
    render(<ControlledGroup initialValue="c" />);
    const optionC = screen.getByRole("radio", { name: "C" });
    const optionA = screen.getByRole("radio", { name: "A" });
    const optionD = screen.getByRole("radio", { name: "D" });

    fireEvent.keyDown(optionC, { key: "End" });
    expect(optionD.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(optionD);

    fireEvent.keyDown(optionD, { key: "Home" });
    expect(optionA.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(optionA);
  });

  it("skips disabled options at either edge when jumping with Home and End", () => {
    const withDisabledEdges: readonly RadioCardOption<Letter>[] = [
      { value: "a", label: "A", disabled: true },
      { value: "b", label: "B" },
      { value: "c", label: "C" },
      { value: "d", label: "D", disabled: true },
    ];
    render(<ControlledGroup initialValue="b" options={withDisabledEdges} />);
    const optionB = screen.getByRole("radio", { name: "B" });
    const optionC = screen.getByRole("radio", { name: "C" });

    fireEvent.keyDown(optionB, { key: "End" });
    expect(optionC.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(optionC);

    fireEvent.keyDown(optionC, { key: "Home" });
    expect(optionB.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(optionB);
  });

  it("keeps a lone enabled option selected when the other options are disabled", () => {
    const onlyOneEnabled: readonly RadioCardOption<Letter>[] = [
      { value: "a", label: "A", disabled: true },
      { value: "b", label: "B" },
      { value: "c", label: "C", disabled: true },
    ];
    render(<ControlledGroup initialValue="b" options={onlyOneEnabled} />);
    const optionB = screen.getByRole("radio", { name: "B" });

    fireEvent.keyDown(optionB, { key: "ArrowRight" });
    expect(optionB.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(optionB);

    fireEvent.keyDown(optionB, { key: "ArrowLeft" });
    expect(optionB.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(optionB);
  });

  it("ignores ArrowUp and ArrowDown", () => {
    render(<ControlledGroup initialValue="a" />);
    const optionA = screen.getByRole("radio", { name: "A" });

    expect(fireEvent.keyDown(optionA, { key: "ArrowDown" })).toBe(true);
    expect(optionA.getAttribute("aria-checked")).toBe("true");

    expect(fireEvent.keyDown(optionA, { key: "ArrowUp" })).toBe(true);
    expect(optionA.getAttribute("aria-checked")).toBe("true");
  });

  it("selects an option on click and does nothing when clicking a disabled option", () => {
    render(<ControlledGroup initialValue="a" />);
    const optionA = screen.getByRole("radio", { name: "A" });
    const optionB = screen.getByRole("radio", { name: "B" });
    const optionC = screen.getByRole("radio", { name: "C" });

    fireEvent.click(optionC);
    expect(optionC.getAttribute("aria-checked")).toBe("true");
    expect(optionA.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(optionB);
    expect(optionC.getAttribute("aria-checked")).toBe("true");
    expect(optionB.getAttribute("aria-checked")).toBe("false");
  });

  it("leaves modified arrow keys, Home, and End to their owners", () => {
    render(<ControlledGroup initialValue="a" />);
    const optionA = screen.getByRole("radio", { name: "A" });

    for (const modifier of ["metaKey", "ctrlKey", "altKey", "shiftKey"] as const) {
      for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) {
        expect(fireEvent.keyDown(optionA, { key, [modifier]: true })).toBe(true);
        expect(optionA.getAttribute("aria-checked")).toBe("true");
      }
    }
  });
});

describe("RadioCardGroup keyboard navigation (vertical)", () => {
  it("sets aria-orientation and moves selection with ArrowDown/ArrowUp instead of left/right", () => {
    render(<ControlledGroup initialValue="a" orientation="vertical" />);
    const optionA = screen.getByRole("radio", { name: "A" });
    const optionC = screen.getByRole("radio", { name: "C" });

    expect(screen.getByRole("radiogroup").getAttribute("aria-orientation")).toBe("vertical");
    expect(screen.getByRole("radiogroup").getAttribute("data-orientation")).toBe("vertical");

    // ArrowRight is the wrong axis for a vertical group; it must do nothing.
    fireEvent.keyDown(optionA, { key: "ArrowRight" });
    expect(optionA.getAttribute("aria-checked")).toBe("true");

    fireEvent.keyDown(optionA, { key: "ArrowDown" });
    expect(optionC.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(optionC);

    fireEvent.keyDown(optionC, { key: "ArrowUp" });
    expect(optionA.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(optionA);
  });
});
