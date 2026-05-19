// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountSettingsPane } from "../src/account/AccountSettingsPane";

describe("AccountSettingsPane", () => {
  afterEach(cleanup);

  it("renders a connected GitHub identity", () => {
    render(
      <AccountSettingsPane
        displayName="Pablo"
        email="pablo@example.com"
        profileSummary="Ready for cloud workspaces."
        githubLabel="@pablo"
        providers={[
          {
            provider: "github",
            label: "GitHub",
            accountLabel: "@pablo",
            connected: true,
            primary: true,
          },
        ]}
        actions={{}}
      />,
    );

    expect(screen.getByText("Pablo")).toBeTruthy();
    expect(screen.getAllByText("@pablo").length).toBeGreaterThan(0);
    expect(screen.getByText("Primary")).toBeTruthy();
    expect(screen.getByText("Connected")).toBeTruthy();
  });

  it("renders a missing GitHub action", () => {
    const connectGitHub = vi.fn();

    render(
      <AccountSettingsPane
        displayName="Google user"
        email="google@example.com"
        profileSummary="GitHub is required."
        githubLabel="Required"
        providers={[
          {
            provider: "github",
            label: "GitHub",
            accountLabel: "Required",
            connected: false,
            primary: true,
          },
        ]}
        actions={{
          connectGitHub: {
            label: "Connect GitHub",
            onClick: connectGitHub,
          },
        }}
      />,
    );

    fireEvent.click(screen.getByText("Connect GitHub"));
    expect(connectGitHub).toHaveBeenCalledTimes(1);
  });

  it("renders multiple linked providers", () => {
    render(
      <AccountSettingsPane
        displayName="Pablo"
        email="pablo@example.com"
        profileSummary="Ready."
        githubLabel="@pablo"
        providers={[
          {
            provider: "github",
            label: "GitHub",
            accountLabel: "@pablo",
            connected: true,
            primary: true,
          },
          {
            provider: "google",
            label: "Google",
            accountLabel: "pablo@gmail.com",
            connected: true,
          },
          {
            provider: "apple",
            label: "Apple",
            accountLabel: "Not connected",
            connected: false,
          },
        ]}
        actions={{}}
      />,
    );

    expect(screen.getByText("pablo@gmail.com")).toBeTruthy();
    expect(screen.getByText("Apple")).toBeTruthy();
    expect(screen.getAllByText("Not connected").length).toBeGreaterThan(0);
  });
});
