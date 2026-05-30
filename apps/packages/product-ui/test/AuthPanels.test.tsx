// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AUTH_PROVIDER_ORDER,
  AUTH_REQUIRED_GITHUB_COPY,
  AUTH_SIGN_IN_COPY,
  authProviderPresentation,
} from "@proliferate/product-domain/auth/presentation";

import { AuthStartPanel } from "../src/auth/AuthStartPanel";
import { ConnectGitHubRequiredPanel } from "../src/auth/ConnectGitHubRequiredPanel";
import { RedirectCallbackScreen } from "../src/auth/RedirectCallbackScreen";

describe("auth product panels", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders the shared provider order and sign-in copy", () => {
    render(
      <AuthStartPanel
        title={AUTH_SIGN_IN_COPY.title}
        subtitle={AUTH_SIGN_IN_COPY.subtitle}
        footer={AUTH_SIGN_IN_COPY.footer}
        note={AUTH_SIGN_IN_COPY.note}
        providers={AUTH_PROVIDER_ORDER.map((provider) => ({
          id: provider,
          label: authProviderPresentation(provider).actionLabel,
          primary: provider === "github",
          onClick: () => undefined,
        }))}
      />,
    );

    expect(screen.getByText(AUTH_SIGN_IN_COPY.title)).toBeTruthy();
    expect(screen.getByText(AUTH_SIGN_IN_COPY.note)).toBeTruthy();

    const providerButtons = screen.getAllByRole("button");
    expect(providerButtons.map((button) => button.textContent)).toEqual([
      "Continue with GitHub",
      "Continue with Apple",
      "Continue with Google",
    ]);
    expect(providerButtons[0].className).toContain("bg-foreground");
  });

  it("renders the required GitHub linking panel with shared copy", () => {
    render(
      <ConnectGitHubRequiredPanel
        title={AUTH_REQUIRED_GITHUB_COPY.title}
        subtitle={AUTH_REQUIRED_GITHUB_COPY.subtitle}
        footer={AUTH_REQUIRED_GITHUB_COPY.footer}
        actionLabel={authProviderPresentation("github").actionLabel}
        onConnect={() => undefined}
        onSignOut={() => undefined}
      />,
    );

    expect(screen.getByText(AUTH_REQUIRED_GITHUB_COPY.title)).toBeTruthy();
    expect(screen.getByText(AUTH_REQUIRED_GITHUB_COPY.subtitle)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue with GitHub" })).toBeTruthy();
  });

  it("renders compact callback and error states", () => {
    render(
      <RedirectCallbackScreen
        title="You're signed in"
        description="Return to the app to continue."
        statusLabel="Signed in"
        tone="success"
        brandLabel={null}
      />,
    );
    expect(screen.getByText("You're signed in")).toBeTruthy();
    cleanup();

    render(
      <RedirectCallbackScreen
        title="Sign-in failed"
        description="Try again."
        statusLabel="Error"
        tone="error"
        detail="access_denied"
        brandLabel={null}
      />,
    );
    expect(screen.getByText("Sign-in failed")).toBeTruthy();
    expect(screen.getByText("access_denied")).toBeTruthy();
  });

  it("resolves the handoff mark after the outgoing braille sweep", () => {
    vi.useFakeTimers();

    const { container } = render(
      <RedirectCallbackScreen
        title="Checking your session"
        description="Opening Proliferate."
        statusLabel="Desktop handoff"
        variant="handoff"
      />,
    );

    const mark = screen.getByTestId("redirect-callback-living-mark");
    expect(mark.className).toContain("relative size-12");
    expect(mark.className).toContain("overflow-hidden");
    expect(screen.getByTestId("redirect-callback-braille-layer").className).toContain(
      "absolute inset-0 flex items-center justify-center",
    );

    const seenFrames = new Set<string>();
    const readBrailleFrame = () =>
      screen.queryByTestId("redirect-callback-braille-layer")?.textContent ?? "";
    seenFrames.add(readBrailleFrame());
    for (let frame = 1; frame < 13; frame += 1) {
      act(() => {
        vi.advanceTimersByTime(60);
      });
      seenFrames.add(readBrailleFrame());
    }
    act(() => {
      vi.advanceTimersByTime(120);
    });

    expect(screen.getByTestId("redirect-callback-icon-layer").className).toContain(
      "absolute inset-0 flex items-center justify-center",
    );
    expect(screen.queryByTestId("redirect-callback-braille-layer")).toBeNull();
    expect(seenFrames).toContain("⣿⣿");
    expect(seenFrames).toContain("⣾⣿");
    expect(seenFrames).toContain("⣴⣿");
    expect(seenFrames).not.toContain("⠀⠀");
    expect(container.querySelector(".animate-resolve-0")).toBeTruthy();
  });
});
