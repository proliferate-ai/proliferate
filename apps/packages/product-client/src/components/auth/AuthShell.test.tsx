// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  githubCatch: vi.fn(),
  githubSignIn: vi.fn(),
  ssoCatch: vi.fn(),
  ssoSignIn: vi.fn(),
}));

vi.mock("#product/hooks/auth/workflows/use-github-sign-in", () => ({
  useGitHubSignIn: () => ({
    signIn: mocks.githubSignIn,
    submitting: false,
    error: null,
    signInAvailable: true,
    signInChecking: false,
    signInUnavailableDescription: "",
    cancelSignIn: vi.fn(async () => {}),
  }),
}));

vi.mock("#product/hooks/auth/workflows/use-sso-sign-in", () => ({
  useSsoSignIn: () => ({
    signIn: mocks.ssoSignIn,
    submitting: false,
    error: null,
    signInAvailable: true,
    signInChecking: false,
    signInUnavailableDescription: "",
    displayName: "Acme",
    cancelSignIn: vi.fn(async () => {}),
  }),
}));

vi.mock("#product/hooks/auth/workflows/use-password-sign-in", () => ({
  usePasswordSignIn: () => ({
    signIn: vi.fn(async () => {}),
    submitting: false,
    error: null,
    signInAvailable: false,
  }),
}));

vi.mock("#product/components/auth/AuthScreenLayout", () => ({
  AuthScreenLayout: (props: {
    onGitHubSignIn: () => void;
    onSsoSignIn: () => void;
  }) => (
    <>
      <button onClick={props.onGitHubSignIn}>GitHub</button>
      <button onClick={props.onSsoSignIn}>SSO</button>
    </>
  ),
}));

import { AuthShell } from "./AuthShell";

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.githubSignIn.mockReturnValue({
    catch: mocks.githubCatch,
  } as unknown as Promise<void>);
  mocks.ssoSignIn.mockReturnValue({
    catch: mocks.ssoCatch,
  } as unknown as Promise<void>);
});

describe("AuthShell", () => {
  it("consumes GitHub and SSO rejections after their hooks surface the error", () => {
    render(<AuthShell mode="auth" markComplete />);

    fireEvent.click(screen.getByRole("button", { name: "GitHub" }));
    fireEvent.click(screen.getByRole("button", { name: "SSO" }));

    expect(mocks.githubCatch).toHaveBeenCalledOnce();
    expect(mocks.ssoCatch).toHaveBeenCalledOnce();
  });
});
