// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsShell } from "../src/settings/SettingsShell";

describe("SettingsShell", () => {
  afterEach(cleanup);

  it("renders grouped sections and ignores disabled items", () => {
    const onSelectSection = vi.fn();

    render(
      <SettingsShell
        activeSectionId="account"
        groups={[
          {
            label: "General",
            items: [
              { id: "account", label: "Account", icon: <span>A</span> },
              { id: "cloud", label: "Cloud", icon: <span>C</span>, disabled: true },
            ],
          },
        ]}
        onSelectSection={onSelectSection}
      >
        <div>Account pane</div>
      </SettingsShell>,
    );

    expect(screen.getByText("General")).toBeTruthy();
    expect(screen.getByText("Account")).toBeTruthy();
    expect(screen.getByText("Cloud")).toBeTruthy();
    expect(screen.getByText("Account pane")).toBeTruthy();

    fireEvent.click(screen.getByText("Account"));
    expect(onSelectSection).toHaveBeenCalledWith("account");

    fireEvent.click(screen.getByText("Cloud"));
    expect(onSelectSection).not.toHaveBeenCalledWith("cloud");
  });
});
