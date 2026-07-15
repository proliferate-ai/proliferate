// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComposerIntegrationsModel } from "@/hooks/cloud/derived/use-composer-integrations-state";
import { ComposerIntegrationsControl } from "./ComposerIntegrationsControl";

const mocks = vi.hoisted(() => ({
  state: {
    mode: "hidden",
    connectedCount: 0,
    providers: [],
    reauthLabel: null,
  } as ComposerIntegrationsModel,
  navigate: vi.fn(),
}));

vi.mock("@/hooks/cloud/derived/use-composer-integrations-state", () => ({
  useComposerIntegrationsState: () => mocks.state,
}));

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => mocks.navigate,
}));

// IntegrationIcon reads the resolved theme mode; stub it to a plain marker so
// the popover rows render without the theme provider.
vi.mock("@/components/settings/panes/integrations/IntegrationIcon", () => ({
  IntegrationIcon: ({ namespace }: { namespace: string }) => (
    <span data-testid={`icon-${namespace}`} />
  ),
}));

function healthyProvider(overrides = {}) {
  return {
    definitionId: "def-1",
    namespace: "linear",
    displayName: "Linear",
    health: "ready" as const,
    needsReauth: false,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.state = { mode: "hidden", connectedCount: 0, providers: [], reauthLabel: null };
});

describe("ComposerIntegrationsControl", () => {
  it("renders nothing when no integrations are connected", () => {
    const { container } = render(<ComposerIntegrationsControl />);

    expect(container.firstChild).toBeNull();
  });

  it("shows the connected count in the quiet state", () => {
    mocks.state = {
      mode: "quiet",
      connectedCount: 3,
      providers: [
        healthyProvider(),
        healthyProvider({ definitionId: "def-2", namespace: "notion", displayName: "Notion" }),
        healthyProvider({ definitionId: "def-3", namespace: "slack", displayName: "Slack" }),
      ],
      reauthLabel: null,
    };
    render(<ComposerIntegrationsControl />);

    expect(screen.getByRole("button", { name: /3 connected integrations/i })).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("shows the single-provider reauth label in the urgent state", () => {
    mocks.state = {
      mode: "urgent",
      connectedCount: 2,
      providers: [
        healthyProvider({ definitionId: "def-2", namespace: "notion", displayName: "Notion", health: "needs_reauth", needsReauth: true }),
        healthyProvider(),
      ],
      reauthLabel: "Notion needs re-authentication",
    };
    render(<ComposerIntegrationsControl />);

    expect(screen.getByText("Notion needs re-authentication")).toBeTruthy();
  });

  it("shows the count reauth label when several providers need reauth", () => {
    mocks.state = {
      mode: "urgent",
      connectedCount: 2,
      providers: [
        healthyProvider({ health: "needs_reauth", needsReauth: true }),
        healthyProvider({ definitionId: "def-2", namespace: "notion", displayName: "Notion", health: "needs_reauth", needsReauth: true }),
      ],
      reauthLabel: "2 integrations need re-authentication",
    };
    render(<ComposerIntegrationsControl />);

    expect(screen.getByText("2 integrations need re-authentication")).toBeTruthy();
  });

  it("opens a popover listing connected providers on click", () => {
    mocks.state = {
      mode: "quiet",
      connectedCount: 2,
      providers: [
        healthyProvider(),
        healthyProvider({ definitionId: "def-2", namespace: "notion", displayName: "Notion" }),
      ],
      reauthLabel: null,
    };
    render(<ComposerIntegrationsControl />);

    fireEvent.click(screen.getByRole("button", { name: /connected integrations/i }));

    expect(screen.getByText("Linear")).toBeTruthy();
    expect(screen.getByText("Notion")).toBeTruthy();
    expect(screen.getByText("Manage integrations")).toBeTruthy();
  });

  it("deep-links a reconnect row to the user integrations settings section", () => {
    mocks.state = {
      mode: "urgent",
      connectedCount: 1,
      providers: [
        healthyProvider({ health: "needs_reauth", needsReauth: true }),
      ],
      reauthLabel: "Linear needs re-authentication",
    };
    render(<ComposerIntegrationsControl />);

    fireEvent.click(screen.getByRole("button", { name: /needs re-authentication/i }));
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));

    expect(mocks.navigate).toHaveBeenCalledWith("/settings?section=integrations");
  });

  it("deep-links Manage integrations to the user integrations settings section", () => {
    mocks.state = {
      mode: "quiet",
      connectedCount: 1,
      providers: [healthyProvider()],
      reauthLabel: null,
    };
    render(<ComposerIntegrationsControl />);

    fireEvent.click(screen.getByRole("button", { name: /connected integration/i }));
    fireEvent.click(screen.getByText("Manage integrations"));

    expect(mocks.navigate).toHaveBeenCalledWith("/settings?section=integrations");
  });
});
