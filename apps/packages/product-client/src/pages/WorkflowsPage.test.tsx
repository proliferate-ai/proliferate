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
import type { WorkflowDefinitionRecordV2 } from "@proliferate/cloud-sdk";
import { WorkflowsPage } from "#product/pages/WorkflowsPage";
import type { WorkflowStarterTemplateV2 } from "#product/config/workflows/starter-templates";
import { WORKFLOW_STARTER_TEMPLATES_V2 } from "#product/config/workflows/starter-templates";
import { useAuthStore } from "#product/test/auth-store-double";

const mainSurface = vi.hoisted(() => vi.fn());
const builderSurface = vi.hoisted(() => vi.fn());
const authMode = vi.hoisted(() => ({ devBypassed: false }));
const workflowsV2 = vi.hoisted(() => ({ enabled: true }));

class TestIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);

vi.mock("#product/lib/domain/auth/auth-mode", () => ({
  isDevAuthBypassed: () => authMode.devBypassed,
}));

vi.mock("#product/lib/domain/capabilities/workflows-v2", () => ({
  isWorkflowsV2Enabled: () => workflowsV2.enabled,
}));

// WorkflowsPage reads normalized auth through the host; bridge the store so the
// existing setState-driven tests keep steering it.
vi.mock("@proliferate/product-client/host/ProductHostProvider", async () => {
  const { useAuthStore } = await import("#product/test/auth-store-double");
  const { authStoreBridgedHost } = await import("#product/test/product-host-fixtures");
  return {
    useProductHost: () =>
      authStoreBridgedHost(
        useAuthStore((s) => s.status),
        useAuthStore((s) => s.user),
      ),
  };
});

vi.mock("#product/components/workflows/main/WorkflowsMainSurface", () => ({
  WorkflowsMainSurface: (props: {
    authCacheScope: string;
    onEdit: (id: string) => void;
    onNew: (template: WorkflowStarterTemplateV2 | null) => void;
  }) => {
    mainSurface(props);
    return (
      <section data-testid="workflows-main">
        <button type="button" onClick={() => props.onEdit("wf-existing")}>
          go-to-edit
        </button>
        <button type="button" onClick={() => props.onNew(WORKFLOW_STARTER_TEMPLATES_V2[0])}>
          go-to-new-from-template
        </button>
        <button type="button" onClick={() => props.onNew(null)}>
          go-to-new-blank
        </button>
      </section>
    );
  },
}));

vi.mock("#product/components/workflows/builder-v2/WorkflowBuilderSurface", () => ({
  WorkflowBuilderSurface: (props: {
    definitionId: string | null;
    template?: WorkflowStarterTemplateV2 | null;
    authCacheScope: string;
  }) => {
    builderSurface(props);
    return <section data-testid="workflow-builder" />;
  },
}));

vi.mock("#product/components/workspace/shell/screen/MainSidebarPageShell", () => ({
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
        <Route path="/workflows/:workflowId/runs/:runId" element={<WorkflowsPage />} />
        <Route path="/login" element={<LoginProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

function signIn() {
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
}

describe("WorkflowsPage authentication boundary", () => {
  beforeEach(() => {
    authMode.devBypassed = false;
    workflowsV2.enabled = true;
    useAuthStore.setState({
      status: "anonymous",
      session: null,
      user: null,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    mainSurface.mockClear();
    builderSurface.mockClear();
  });

  it("shows a sign-in gate without mounting cloud workflow queries", () => {
    renderWorkflows("/workflows/workflow-1?source=sidebar#details");

    expect(screen.getByText("Sign in to use workflows")).toBeTruthy();
    expect(mainSurface).not.toHaveBeenCalled();

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
    expect(mainSurface).not.toHaveBeenCalled();
  });

  it("explains that development auth bypass cannot access personal workflows", () => {
    authMode.devBypassed = true;
    signIn();

    renderWorkflows();

    expect(screen.getByText("Workflows need account authentication")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    expect(mainSurface).not.toHaveBeenCalled();
  });
});

describe("WorkflowsPage v2 routing", () => {
  beforeEach(() => {
    authMode.devBypassed = false;
    workflowsV2.enabled = true;
    signIn();
  });

  afterEach(() => {
    cleanup();
    mainSurface.mockClear();
    builderSurface.mockClear();
  });

  it("renders the v2 main surface at the list route with the authenticated scope", () => {
    renderWorkflows("/workflows");

    expect(screen.getByTestId("workflows-main")).toBeTruthy();
    expect(mainSurface).toHaveBeenCalledWith(expect.objectContaining({
      authCacheScope: "user-1",
    }));
    expect(builderSurface).not.toHaveBeenCalled();
  });

  it("renders the builder for an existing definition id", () => {
    renderWorkflows("/workflows/wf-123");

    expect(screen.getByTestId("workflow-builder")).toBeTruthy();
    expect(builderSurface).toHaveBeenCalledWith(expect.objectContaining({
      definitionId: "wf-123",
      authCacheScope: "user-1",
    }));
  });

  it("renders the builder blank for the 'new' sentinel with no state", () => {
    renderWorkflows("/workflows/new");

    expect(screen.getByTestId("workflow-builder")).toBeTruthy();
    expect(builderSurface).toHaveBeenCalledWith(expect.objectContaining({
      definitionId: null,
      template: null,
    }));
  });

  it("navigates list -> new with the chosen template, and edit -> the definition id", () => {
    renderWorkflows("/workflows");

    fireEvent.click(screen.getByText("go-to-new-from-template"));

    expect(screen.getByTestId("workflow-builder")).toBeTruthy();
    expect(builderSurface).toHaveBeenCalledWith(expect.objectContaining({
      definitionId: null,
      template: WORKFLOW_STARTER_TEMPLATES_V2[0],
    }));
  });

  it("navigates list -> edit with the clicked definition id", () => {
    renderWorkflows("/workflows");

    fireEvent.click(screen.getByText("go-to-edit"));

    expect(screen.getByTestId("workflow-builder")).toBeTruthy();
    expect(builderSurface).toHaveBeenCalledWith(expect.objectContaining({
      definitionId: "wf-existing",
    }));
  });

  it("redirects the gen-1 per-run route back to the list", () => {
    renderWorkflows("/workflows/wf-123/runs/run-1");

    expect(screen.getByTestId("workflows-main")).toBeTruthy();
    expect(builderSurface).not.toHaveBeenCalled();
  });
});

describe("WorkflowsPage with the v2 launch flag off", () => {
  beforeEach(() => {
    authMode.devBypassed = false;
    workflowsV2.enabled = false;
    signIn();
  });

  afterEach(() => {
    cleanup();
    mainSurface.mockClear();
    builderSurface.mockClear();
  });

  it("shows the unavailable state instead of any workflows surface", () => {
    renderWorkflows("/workflows");

    expect(screen.getByText("Workflows are being rebuilt")).toBeTruthy();
    expect(mainSurface).not.toHaveBeenCalled();
    expect(builderSurface).not.toHaveBeenCalled();
  });

  it("shows the unavailable state for a definition route too", () => {
    renderWorkflows("/workflows/wf-123");

    expect(screen.getByText("Workflows are being rebuilt")).toBeTruthy();
    expect(builderSurface).not.toHaveBeenCalled();
  });
});

// Unused but keeps the definition-record type import intentional if a future
// test needs to assert on a real `WorkflowBuilderSurface` payload shape.
type _KeepImport = WorkflowDefinitionRecordV2;
