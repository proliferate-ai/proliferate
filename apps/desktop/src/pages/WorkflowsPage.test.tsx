// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { WorkflowsPage } from "@/pages/WorkflowsPage";
import { useAuthStore } from "@/stores/auth/auth-store";

const workflowSurface = vi.hoisted(() => vi.fn());
const authMode = vi.hoisted(() => ({ devBypassed: false }));

vi.mock("@proliferate/product-client/host/ProductHostProvider", async () => {
  const { useAuthStore } = await import("@/stores/auth/auth-store");
  return {
    useProductHost: () => {
      const auth = useAuthStore();
      return {
        auth: {
          authRequired: !authMode.devBypassed,
          state: auth.status === "bootstrapping"
            ? { status: "loading" as const }
            : auth.status === "authenticated"
              ? {
                  status: "authenticated" as const,
                  user: auth.user
                    ? {
                        id: auth.user.id,
                        email: auth.user.email ?? undefined,
                        name: auth.user.display_name ?? undefined,
                      }
                    : null,
                  readiness: { status: "ready" as const },
                }
              : { status: "anonymous" as const, methods: [] },
        },
      };
    },
  };
});

class TestIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);

vi.mock("@proliferate/product-surfaces/workflows/WorkflowDefinitionsSurface", () => ({
  WorkflowDefinitionsSurface: (props: {
    authCacheScope: string;
    selectedWorkflowId: string | null;
  }) => {
    workflowSurface(props);
    return <section data-testid="workflow-definitions" />;
  },
}));

vi.mock("@/components/workspace/shell/screen/MainSidebarPageShell", () => ({
  MainSidebarPageShell: ({ children }: { children: ReactNode }) => (
    <main>{children}</main>
  ),
}));

function LoginProbe() {
  const location = useLocation();
  const state = location.state as { from?: string } | null;
  return <p data-testid="login-return-to">{state?.from ?? "missing"}</p>;
}

function renderWorkflows(path = "/workflows") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/workflows" element={<WorkflowsPage />} />
        <Route path="/workflows/:workflowId" element={<WorkflowsPage />} />
        <Route path="/login" element={<LoginProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("WorkflowsPage authentication boundary", () => {
  beforeEach(() => {
    authMode.devBypassed = false;
    useAuthStore.setState({
      status: "anonymous",
      session: null,
      user: null,
      error: null,
      issue: null,
    });
  });

  afterEach(() => {
    cleanup();
    workflowSurface.mockClear();
  });

  it("shows a sign-in gate without mounting cloud workflow queries", () => {
    renderWorkflows("/workflows/workflow-1?source=sidebar#details");

    expect(screen.getByText("Sign in to use workflows")).toBeTruthy();
    expect(workflowSurface).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(screen.getByTestId("login-return-to").textContent).toBe(
      "/workflows/workflow-1?source=sidebar#details",
    );
  });

  it("does not invent a cache scope when authenticated identity is missing", () => {
    useAuthStore.setState({ status: "authenticated", user: null });

    renderWorkflows();

    expect(screen.getByText("Account details unavailable")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    expect(workflowSurface).not.toHaveBeenCalled();
  });

  it("explains that development auth bypass cannot access personal workflows", () => {
    authMode.devBypassed = true;
    useAuthStore.setState({
      status: "authenticated",
      user: {
        id: "local-dev-user",
        email: "dev@proliferate.local",
        display_name: "Local Developer",
      },
    });

    renderWorkflows();

    expect(screen.getByText("Workflows need account authentication")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    expect(workflowSurface).not.toHaveBeenCalled();
  });

  it("mounts the connected surface only with the authenticated user's cache scope", () => {
    useAuthStore.setState({
      status: "authenticated",
      session: null,
      user: {
        id: "user-1",
        email: "user@example.com",
        display_name: "Test User",
      },
      error: null,
    });

    renderWorkflows("/workflows/workflow-1");

    expect(screen.getByTestId("workflow-definitions")).toBeTruthy();
    expect(workflowSurface).toHaveBeenCalledWith(expect.objectContaining({
      authCacheScope: "user-1",
      selectedWorkflowId: "workflow-1",
    }));
  });
});
