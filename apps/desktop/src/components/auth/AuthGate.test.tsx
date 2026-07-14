// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { BootstrappedRoute } from "@/components/auth/AuthGate";
import { AuthScreenLayout } from "@/components/auth/AuthScreenLayout";
import { LoginScreen } from "@/components/auth/LoginScreen";
import { SessionCheckScreen } from "@/components/auth/SessionCheckScreen";

const hostAuthOverrides = vi.hoisted(() => ({
  readiness: { status: "ready" } as
    | { status: "ready" }
    | { status: "action_required"; action: "connect_github" },
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", async () => {
  const { useAuthStore } = await import("@/stores/auth/auth-store");
  return {
    useProductHost: () => {
      const storedAuth = useAuthStore();
      const state = storedAuth.status === "bootstrapping"
        ? { status: "loading" as const }
        : storedAuth.status === "authenticated"
          ? {
              status: "authenticated" as const,
              user: storedAuth.user
                ? {
                    id: storedAuth.user.id,
                    email: storedAuth.user.email ?? undefined,
                    name: storedAuth.user.display_name ?? undefined,
                  }
                : null,
              readiness: hostAuthOverrides.readiness,
            }
          : {
              status: "anonymous" as const,
              methods: [{ kind: "github" as const, enabled: true }],
              issue: storedAuth.issue ?? undefined,
            };

      return {
        auth: {
          authRequired: true,
          state,
          startLogin: vi.fn(async () => {}),
          finishLogin: vi.fn(async () => {}),
          cancelLogin: vi.fn(async () => {}),
          logout: vi.fn(async () => {}),
        },
        deployment: {
          apiBaseUrl: "https://api.example.test",
          switchDeployment: vi.fn(async () => {}),
          resetDeployment: vi.fn(async () => {}),
        },
        desktop: {
          updater: { getVersion: vi.fn(async () => "0.0.0-test") },
        },
      };
    },
  };
});

// Force the auth-required gate so anonymous resolves to the sign-in shell
// (exercising the loading -> login -> app reveal path).
vi.mock("@/lib/domain/auth/auth-mode", () => ({
  isProductAuthRequired: () => true,
}));

// BootstrappedRoute renders <AuthShell>, which pulls in the GitHub sign-in
// availability query + capability hooks. These BootstrappedRoute tests only care
// about the overlay/reveal lifecycle, so stub the shell to a marker that echoes
// its mode and fires onMarkResolved once told the mark has settled
// (markComplete) — mirroring the real living mark so the reveal fade is actually
// exercised (and the post-sign-in deadlock would be caught).
vi.mock("@/components/auth/AuthShell", async () => {
  const { useEffect, useRef } = await import("react");
  return {
    AuthShell: ({
      mode,
      markComplete,
      onMarkResolved,
    }: {
      mode: string;
      markComplete: boolean;
      onMarkResolved?: () => void;
    }) => {
      // Latch like the real ProliferateLivingMark: onResolved fires AT MOST
      // ONCE. Without this latch the mock would re-fire whenever the callback
      // identity changes, masking the post-sign-in deadlock the regression
      // test exists to catch.
      const resolvedRef = useRef(false);
      useEffect(() => {
        if (markComplete && !resolvedRef.current) {
          resolvedRef.current = true;
          onMarkResolved?.();
        }
      }, [markComplete, onMarkResolved]);
      return (
        <div data-testid="auth-shell" data-mode={mode}>
          shell
        </div>
      );
    },
  };
});
import {
  buildUiTextScaleCssVariables,
  DEFAULT_UI_TEXT_SCALE_CSS_VARIABLES,
  UI_FONT_SCALES,
} from "@/lib/domain/preferences/appearance";
import { useAuthStore } from "@/stores/auth/auth-store";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  for (const property of Object.keys(DEFAULT_UI_TEXT_SCALE_CSS_VARIABLES)) {
    document.documentElement.style.removeProperty(property);
  }
});

function setRootToNonDefaultTextScale() {
  for (const [property, value] of Object.entries(
    buildUiTextScaleCssVariables(UI_FONT_SCALES.xxxlarge),
  )) {
    document.documentElement.style.setProperty(property, value);
  }
}

function getAuthAppearanceBoundary(): HTMLElement {
  const boundary = document.querySelector<HTMLElement>("[data-auth-default-appearance]");
  if (!boundary) {
    throw new Error("Missing auth appearance boundary");
  }
  return boundary;
}

function expectDefaultAuthAppearance(element: HTMLElement) {
  for (const [property, value] of Object.entries(DEFAULT_UI_TEXT_SCALE_CSS_VARIABLES)) {
    expect(element.style.getPropertyValue(property)).toBe(value);
  }
}

describe("SessionCheckScreen", () => {
  it("uses the auth-style checking copy and branded mark surface", () => {
    const html = renderToStaticMarkup(<SessionCheckScreen />);

    expect(html).toContain("data-auth-session-check");
    expect(html).toContain("Checking your session");
    expect(html).toContain("Proliferate is restoring your account");
    expect(html).not.toContain("data-jank-canary=\"braille\"");
  });

  it("breathes the brand mark while checking and settles it on resolve", () => {
    const { container, rerender } = render(<SessionCheckScreen />);

    expect(container.querySelector('[data-brand-mark="breathing"]')).toBeTruthy();
    expect(container.querySelector(".animate-brand-mark-breathe")).toBeTruthy();

    rerender(<SessionCheckScreen resolving />);

    expect(container.querySelector('[data-brand-mark="settled"]')).toBeTruthy();
    expect(container.querySelector(".animate-brand-mark-settle")).toBeTruthy();
    expect(container.querySelector(".animate-brand-mark-breathe")).toBeNull();
  });

  it("latches onResolved exactly once after the mark settles", async () => {
    const onResolved = vi.fn();
    const { rerender } = render(
      <SessionCheckScreen resolving={false} onResolved={onResolved} />,
    );
    expect(onResolved).not.toHaveBeenCalled();

    rerender(<SessionCheckScreen resolving onResolved={onResolved} />);
    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1));

    rerender(<SessionCheckScreen resolving onResolved={onResolved} />);
    await new Promise((resolve) => window.requestAnimationFrame(() => resolve(null)));
    expect(onResolved).toHaveBeenCalledTimes(1);
  });

  it("ignores user appearance text-size preferences", () => {
    setRootToNonDefaultTextScale();
    render(<SessionCheckScreen />);

    expectDefaultAuthAppearance(getAuthAppearanceBoundary());
  });
});

describe("LoginScreen", () => {
  it("ignores user appearance text-size preferences", () => {
    setRootToNonDefaultTextScale();
    render(
      <LoginScreen
        submitting={false}
        busy={false}
        error={null}
        githubSignInAvailable
        githubSignInChecking={false}
        githubSignInUnavailableDescription=""
        onGitHubSignIn={() => {}}
        onContinueLocally={() => {}}
        canContinueLocally
      />,
    );

    expectDefaultAuthAppearance(getAuthAppearanceBoundary());
  });
});

describe("BootstrappedRoute", () => {
  beforeEach(() => {
    hostAuthOverrides.readiness = { status: "ready" };
    useAuthStore.setState({
      status: "bootstrapping",
      session: null,
      user: null,
      error: null,
      issue: null,
    });
  });

  afterEach(() => {
    hostAuthOverrides.readiness = { status: "ready" };
    useAuthStore.setState({
      status: "bootstrapping",
      session: null,
      user: null,
      error: null,
      issue: null,
    });
  });

  it("shows the loading shell and withholds the workspace while bootstrapping", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<BootstrappedRoute />}>
            <Route path="/" element={<main data-testid="workspace">Workspace</main>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("auth-shell").dataset.mode).toBe("loading");
    expect(screen.queryByTestId("workspace")).toBeNull();
  });

  it("reveals the workspace after sign-in without leaving the shell stuck", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<BootstrappedRoute />}>
            <Route path="/" element={<main data-testid="workspace">Workspace</main>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    // bootstrapping -> loading shell
    expect(screen.getByTestId("auth-shell").dataset.mode).toBe("loading");

    // resolves to anonymous + auth required -> in-place sign-in shell
    act(() => {
      useAuthStore.setState({ status: "anonymous" });
    });
    expect(screen.getByTestId("auth-shell").dataset.mode).toBe("auth");
    expect(screen.queryByTestId("workspace")).toBeNull();

    // sign-in -> authenticated: the persistent shell must fade out and reveal
    // the workspace (regression: the shell used to stay mounted forever here).
    act(() => {
      useAuthStore.setState({ status: "authenticated" });
    });
    await waitFor(() => expect(screen.getByTestId("workspace")).toBeTruthy());
    await waitFor(() => expect(screen.queryByTestId("auth-shell")).toBeNull());
  });

  it("requires GitHub linking before revealing an authenticated workspace", () => {
    hostAuthOverrides.readiness = {
      status: "action_required",
      action: "connect_github",
    };
    useAuthStore.setState({
      status: "authenticated",
      user: {
        id: "user-1",
        email: "founder@example.com",
        display_name: "Founder",
      },
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<BootstrappedRoute />}>
            <Route path="/" element={<main data-testid="workspace">Workspace</main>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Connect GitHub")).toBeTruthy();
    expect(screen.queryByTestId("workspace")).toBeNull();
  });
});

describe("AuthScreenLayout", () => {
  it("keeps the heading constant and disables the action while loading", () => {
    const { rerender } = render(<AuthScreenLayout mode="loading" />);

    expect(screen.getByText("Let's get your life's work done.")).toBeTruthy();
    // ThinkingText renders the label twice (base + aria-hidden sweep copy).
    expect(
      screen.getByText("Restoring your session…", { selector: "[data-thinking-text]" }),
    ).toBeTruthy();
    expect(
      screen.getByText("Continue with GitHub").closest("button")?.disabled,
    ).toBe(true);

    rerender(
      <AuthScreenLayout mode="auth" githubSignInAvailable onGitHubSignIn={() => {}} />,
    );

    // Heading is identical across modes (no reflow), and the action is live.
    expect(screen.getByText("Let's get your life's work done.")).toBeTruthy();
    expect(
      screen.getByText("Continue with GitHub").closest("button")?.disabled,
    ).toBe(false);
  });

  it("offers the inline continue-locally action when allowed", () => {
    render(
      <AuthScreenLayout
        mode="auth"
        githubSignInAvailable
        canContinueLocally
        onContinueLocally={() => {}}
        onGitHubSignIn={() => {}}
      />,
    );

    expect(screen.getByText("start locally")).toBeTruthy();
  });

  it("prioritizes GitHub unavailable copy when every sign-in path is unavailable", () => {
    render(
      <AuthScreenLayout
        mode="auth"
        githubSignInAvailable={false}
        githubSignInUnavailableDescription="Control plane is unreachable."
        ssoSignInUnavailableDescription="SSO is not configured."
      />,
    );

    expect(screen.getByText("Control plane is unreachable.")).toBeTruthy();
    expect(screen.queryByText("SSO is not configured.")).toBeNull();
  });

  it("shows the SSO action when deployment SSO is available", () => {
    const { container } = render(
      <AuthScreenLayout
        mode="auth"
        githubSignInAvailable
        ssoSignInAvailable
        ssoDisplayName="Google SSO"
        onGitHubSignIn={() => {}}
        onSsoSignIn={() => {}}
      />,
    );

    expect(screen.getByText("Continue with GitHub")).toBeTruthy();
    expect(screen.getByText("Continue with Google SSO")).toBeTruthy();
    expect(container.querySelector('[data-auth-provider-brand="google-sso"]')).toBeTruthy();
  });

  it("offers a cancel action while SSO sign-in is pending", () => {
    const onCancelSignIn = vi.fn();

    render(
      <AuthScreenLayout
        mode="auth"
        githubSignInAvailable
        ssoSignInAvailable
        ssoSubmitting
        ssoDisplayName="Okta SSO"
        onGitHubSignIn={() => {}}
        onSsoSignIn={() => {}}
        onCancelSignIn={onCancelSignIn}
      />,
    );

    fireEvent.click(screen.getByText("Cancel sign-in"));

    expect(onCancelSignIn).toHaveBeenCalledTimes(1);
  });

  it("ignores user appearance text-size preferences", () => {
    setRootToNonDefaultTextScale();
    render(<AuthScreenLayout mode="auth" />);

    expectDefaultAuthAppearance(getAuthAppearanceBoundary());
  });
});
