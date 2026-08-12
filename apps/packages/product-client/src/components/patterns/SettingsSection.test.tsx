// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  SETTINGS_CONTROL_WIDTH_CLASS,
  SettingsRow,
} from "#product/components/patterns/SettingsRow";
import { SettingsSection } from "#product/components/patterns/SettingsSection";

describe("SETTINGS_CONTROL_WIDTH_CLASS", () => {
  it("is the shared 240px control width", () => {
    expect(SETTINGS_CONTROL_WIDTH_CLASS).toBe("w-60");
  });
});

describe("SettingsSection", () => {
  afterEach(cleanup);

  it("renders title, description, and rows", () => {
    render(
      <SettingsSection title="Sounds" description="When Proliferate makes noise">
        <SettingsRow label="Completion sound" />
      </SettingsSection>,
    );

    expect(screen.getByText("Sounds")).toBeTruthy();
    expect(screen.getByText("When Proliferate makes noise")).toBeTruthy();
    expect(screen.getByText("Completion sound")).toBeTruthy();
  });

  it("renders an optional right-aligned header action", () => {
    render(
      <SettingsSection title="In use" action={<button type="button">Rescan</button>}>
        <SettingsRow label="Agent" />
      </SettingsSection>,
    );

    expect(screen.getByRole("button", { name: "Rescan" })).toBeTruthy();
  });

  it("omits the header block when title, description, and action are absent, but still renders the group card", () => {
    const { container } = render(
      <SettingsSection>
        <SettingsRow label="Only row" />
      </SettingsSection>,
    );

    const section = container.querySelector("section");
    expect(section?.children).toHaveLength(1);
    const card = section?.firstElementChild;
    expect(card?.className).toContain("rounded-xl");
    expect(card?.className).toContain("bg-surface-elevated-secondary");
    expect(screen.getByText("Only row")).toBeTruthy();
  });

  it("wraps children in the wash card by default", () => {
    const { container } = render(
      <SettingsSection title="Sounds">
        <SettingsRow label="Row" />
      </SettingsSection>,
    );

    const card = container.querySelector("section > div:last-child");
    expect(card?.className).toContain("rounded-xl");
    expect(card?.className).toContain("bg-surface-elevated-secondary");
  });

  it("does not wrap children in the wash card when surface is plain", () => {
    const { container } = render(
      <SettingsSection title="Sounds" surface="plain">
        <SettingsRow label="Row" />
      </SettingsSection>,
    );

    const body = container.querySelector("section > div:last-child");
    expect(body?.className).not.toContain("rounded-xl");
    expect(body?.className).not.toContain("bg-surface-elevated-secondary");
  });

  it("gives the emphasized title variant font-medium weight", () => {
    render(
      <SettingsSection title="Archiving" titleWeight="emphasized">
        <SettingsRow label="Row" />
      </SettingsSection>,
    );

    const title = screen.getByText("Archiving");
    expect(title.className).toContain("font-medium");
    expect(title.className).toContain("text-foreground");
  });
});

describe("SettingsRow", () => {
  afterEach(cleanup);

  it("no longer renders a self border between rows", () => {
    const { container } = render(<SettingsRow label="Row" />);

    const row = container.firstElementChild;
    expect(row?.className).not.toContain("border-t");
  });
});
