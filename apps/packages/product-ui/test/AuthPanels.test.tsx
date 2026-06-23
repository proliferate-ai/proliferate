// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AUTH_PROVIDER_ORDER,
  AUTH_PASSWORD_COPY,
  AUTH_REQUIRED_GITHUB_COPY,
  AUTH_SIGN_IN_COPY,
  authProviderPresentation,
} from "@proliferate/product-domain/auth/presentation";

import { AuthStartPanel } from "../src/auth/AuthStartPanel";
import { ConnectGitHubRequiredPanel } from "../src/auth/ConnectGitHubRequiredPanel";
import { PasswordCredentialForm } from "../src/auth/PasswordCredentialForm";
import { RedirectCallbackScreen } from "../src/auth/RedirectCallbackScreen";

describe("auth product panels", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function readVisibleBrailleDots(container: HTMLElement) {
    return Array.from(
      container.querySelectorAll<HTMLElement>('[data-braille-dot][data-visible="true"]'),
    )
      .map((element) => element.dataset.brailleDot)
      .join(",");
  }

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

  it("renders secondary providers behind the more menu", () => {
    const githubClick = vi.fn();
    const appleClick = vi.fn();
    const googleClick = vi.fn();

    render(
      <AuthStartPanel
        title={AUTH_SIGN_IN_COPY.title}
        subtitle={AUTH_SIGN_IN_COPY.subtitle}
        footer={AUTH_SIGN_IN_COPY.footer}
        providers={[
          {
            id: "github",
            label: "Continue with GitHub",
            primary: true,
            onClick: githubClick,
          },
        ]}
        secondaryLabel="More"
        secondaryActions={[
          {
            id: "apple",
            label: "Continue with Apple",
            onClick: appleClick,
          },
          {
            id: "google",
            label: "Continue with Google",
            onClick: googleClick,
          },
        ]}
        secondaryContent={<div>Email sign-in</div>}
      />,
    );

    expect(screen.getByRole("button", { name: "Continue with GitHub" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "More" })).toBeTruthy();
    expect(screen.queryByText("Continue with Apple")).toBeNull();
    expect(screen.queryByText("Email sign-in")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "More" }));

    expect(screen.getByRole("button", { name: "Continue with Apple" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeTruthy();
    expect(screen.getByText("Email sign-in")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Continue with Apple" }));

    expect(appleClick).toHaveBeenCalledTimes(1);
    expect(githubClick).not.toHaveBeenCalled();
    expect(googleClick).not.toHaveBeenCalled();
    expect(screen.getByText("Email sign-in")).toBeTruthy();
  });

  it("renders the email credential form slot", () => {
    const submit = vi.fn();

    render(
      <AuthStartPanel
        title={AUTH_SIGN_IN_COPY.title}
        subtitle={AUTH_SIGN_IN_COPY.subtitle}
        footer={AUTH_SIGN_IN_COPY.footer}
        credentialForm={(
          <PasswordCredentialForm
            email="reviewer@example.com"
            password="password"
            onEmailChange={() => undefined}
            onPasswordChange={() => undefined}
            onSubmit={submit}
          />
        )}
        providers={[]}
      />,
    );

    expect(screen.getByLabelText(AUTH_PASSWORD_COPY.emailLabel)).toBeTruthy();
    expect(screen.getByLabelText(AUTH_PASSWORD_COPY.passwordLabel)).toBeTruthy();
    screen.getByRole("button", { name: AUTH_PASSWORD_COPY.submitLabel }).click();
    expect(submit).toHaveBeenCalledTimes(1);
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

    const seenDotFrames = new Set<string>([readVisibleBrailleDots(container)]);
    for (let frame = 1; frame < 13; frame += 1) {
      act(() => {
        vi.advanceTimersByTime(60);
      });
      seenDotFrames.add(readVisibleBrailleDots(container));
    }

    expect(readVisibleBrailleDots(container)).toBe("0");

    act(() => {
      vi.advanceTimersByTime(120);
    });

    expect(screen.getByTestId("redirect-callback-icon-layer").className).toContain(
      "absolute inset-0 flex items-center justify-center",
    );
    expect(screen.queryByTestId("redirect-callback-braille-layer")).toBeNull();
    expect(seenDotFrames).toContain("0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15");
    expect(seenDotFrames).toContain("0,1,2,4,5,8");
    expect(seenDotFrames).not.toContain("15");
    expect(container.querySelector(".animate-resolve-0")).toBeTruthy();
  });
});
