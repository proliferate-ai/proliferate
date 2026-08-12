// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountSettingsPane } from "#product/components/settings/panes/account/AccountSettingsPane";

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
    expect(screen.getByText("Primary sign-in method · @pablo")).toBeTruthy();
    expect(screen.getByText("Connected")).toBeTruthy();
  });

  it("renders exactly one Sign out on the profile row and fires its action", () => {
    const onSignOut = vi.fn();
    render(
      <AccountSettingsPane
        displayName="Pablo"
        email="pablo@example.com"
        profileSummary="Ready for cloud workspaces."
        githubLabel="@pablo"
        providers={[]}
        actions={{ signOut: { label: "Sign out", onClick: onSignOut } }}
      />,
    );

    // Sign out lives on the profile identity row now — one affordance, wired
    // through. Dropping the pass-through or re-adding the old footer would
    // change this count.
    const buttons = screen.getAllByRole("button", { name: "Sign out" });
    expect(buttons.length).toBe(1);
    fireEvent.click(buttons[0]);
    expect(onSignOut).toHaveBeenCalledTimes(1);
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
    expect(screen.queryByText("Primary")).toBeNull();
    expect(screen.getByText("Not connected")).toBeTruthy();
  });

  it("renders multiple linked providers", () => {
    const { container } = render(
      <AccountSettingsPane
        displayName="Pablo"
        email="pablo@example.com"
        profileSummary="Ready."
        githubLabel="@pablo"
        providers={[
          {
            provider: "sso",
            label: "Auth0",
            accountLabel: "pablo@proliferate.com",
            connected: true,
          },
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

    expect(screen.getByText("Auth0")).toBeTruthy();
    expect(screen.getByText("pablo@proliferate.com")).toBeTruthy();
    expect(screen.getByText("pablo@gmail.com")).toBeTruthy();
    expect(screen.getByText("Apple")).toBeTruthy();
    expect(screen.getAllByText("Not connected").length).toBeGreaterThan(0);
    // Scoped to the sign-in method rows (icon-control) — the identity header
    // above them carries its own smaller (icon-compact) GitHub glyph.
    const providerIcons = container.querySelectorAll("[data-auth-provider-brand].icon-control");
    expect(providerIcons.length).toBe(4);
    expect([...providerIcons].every((icon) => icon.classList.contains("icon-control"))).toBe(true);
  });

  it("uses SSO brand labels for icons without changing the visible provider label", () => {
    const { container } = render(
      <AccountSettingsPane
        displayName="Pablo"
        email="pablo@example.com"
        profileSummary="Ready."
        githubLabel="@pablo"
        providers={[
          {
            provider: "sso",
            label: "SSO",
            brandLabel: "Google SSO",
            accountLabel: "pablo@proliferate.com",
            connected: true,
          },
        ]}
        actions={{}}
      />,
    );

    expect(screen.getByText("SSO")).toBeTruthy();
    expect(container.querySelector('[data-auth-provider-brand="google-sso"]')).toBeTruthy();
  });

  it("keeps email password separate from linked providers", async () => {
    const setPassword = vi.fn();

    const { container } = render(
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
        ]}
        passwordCredential={{
          enabled: false,
          onSubmit: setPassword,
        }}
        actions={{}}
      />,
    );

    expect(screen.getByText("Email & password")).toBeTruthy();
    expect(screen.getByText("Add a password to sign in with email")).toBeTruthy();
    // The password row has no brand glyph — the account rows above it do.
    expect(container.querySelector('[data-auth-provider-brand="password"]')).toBeNull();
    fireEvent.click(screen.getByText("Set password"));
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "correct horse battery" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "correct horse battery" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Set password" }));

    expect(setPassword).toHaveBeenCalledWith({ newPassword: "correct horse battery" });
    expect(screen.queryByText("Apple")).toBeNull();
  });
});
