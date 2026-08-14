// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthState } from "@proliferate/product-client/host/product-host";

const mocks = vi.hoisted(() => ({
  githubCatch: vi.fn(),
  githubSignIn: vi.fn(),
  githubError: vi.fn<() => string | null>(),
  ssoCatch: vi.fn(),
  ssoSignIn: vi.fn(),
  authState: vi.fn(),
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({ auth: { state: mocks.authState() } }),
}));

vi.mock("#product/hooks/auth/workflows/use-github-sign-in", () => ({
  useGitHubSignIn: () => ({
    signIn: mocks.githubSignIn,
    submitting: false,
    error: mocks.githubError(),
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
    error?: string | null;
  }) => (
    <>
      <button onClick={props.onGitHubSignIn}>GitHub</button>
      <button onClick={props.onSsoSignIn}>SSO</button>
      {props.error ? <p>{props.error}</p> : null}
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
  mocks.authState.mockReturnValue({
    status: "anonymous",
    methods: [],
  } satisfies AuthState);
  mocks.githubError.mockReturnValue(null);
});

describe("AuthShell", () => {
  it("consumes GitHub and SSO rejections after their hooks surface the error", () => {
    render(<AuthShell mode="auth" markComplete />);

    fireEvent.click(screen.getByRole("button", { name: "GitHub" }));
    fireEvent.click(screen.getByRole("button", { name: "SSO" }));

    expect(mocks.githubCatch).toHaveBeenCalledOnce();
    expect(mocks.ssoCatch).toHaveBeenCalledOnce();
  });

  it("renders nothing extra when the anonymous state has no issue", () => {
    const { container } = render(<AuthShell mode="auth" markComplete />);

    expect(container.querySelector("p")).toBeNull();
  });

  it("renders the issue message when the host auth state carries a callback issue", () => {
    mocks.authState.mockReturnValue({
      status: "anonymous",
      methods: [],
      issue: { kind: "callback_failed", reason: "state_mismatch" },
    } satisfies AuthState);

    render(<AuthShell mode="auth" markComplete />);

    expect(
      screen.getByText("That sign-in link expired or was already used. Try again."),
    ).not.toBeNull();
  });

  it("prefers an active hook error over the issue message", () => {
    mocks.githubError.mockReturnValue("GitHub sign-in failed");
    mocks.authState.mockReturnValue({
      status: "anonymous",
      methods: [],
      issue: { kind: "callback_failed", reason: "state_mismatch" },
    } satisfies AuthState);

    render(<AuthShell mode="auth" markComplete />);

    expect(screen.getByText("GitHub sign-in failed")).not.toBeNull();
    expect(
      screen.queryByText("That sign-in link expired or was already used. Try again."),
    ).toBeNull();
  });
});
