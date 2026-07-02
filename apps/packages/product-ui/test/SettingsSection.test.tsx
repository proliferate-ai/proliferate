// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SETTINGS_CONTROL_WIDTH_CLASS, SettingsRow } from "../src/settings/SettingsRow";
import { SettingsSection } from "../src/settings/SettingsSection";

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

  it("omits the header block when title, description, and action are absent", () => {
    const { container } = render(
      <SettingsSection>
        <SettingsRow label="Only row" />
      </SettingsSection>,
    );

    const section = container.querySelector("section");
    expect(section?.children).toHaveLength(1);
    expect(screen.getByText("Only row")).toBeTruthy();
  });
});
