// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IntegrationReauthState } from "@/hooks/cloud/derived/use-integration-reauth-state";
import { ComposerIntegrationReauthChip } from "./ComposerIntegrationReauthChip";

const mocks = vi.hoisted(() => ({
  reauthState: {
    providerNames: [],
    label: null,
    visible: false,
  } as IntegrationReauthState,
  navigate: vi.fn(),
}));

vi.mock("@/hooks/cloud/derived/use-integration-reauth-state", () => ({
  useIntegrationReauthState: () => mocks.reauthState,
}));

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => mocks.navigate,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.reauthState = { providerNames: [], label: null, visible: false };
});

describe("ComposerIntegrationReauthChip", () => {
  it("renders nothing when every integration is healthy", () => {
    const { container } = render(<ComposerIntegrationReauthChip />);

    expect(container.firstChild).toBeNull();
  });

  it("shows the provider pill when one integration needs reauth", () => {
    mocks.reauthState = {
      providerNames: ["Linear"],
      label: "Linear needs re-authentication",
      visible: true,
    };
    render(<ComposerIntegrationReauthChip />);

    expect(screen.getByText("Linear needs re-authentication")).toBeTruthy();
  });

  it("shows the count pill when several integrations need reauth", () => {
    mocks.reauthState = {
      providerNames: ["Linear", "Notion"],
      label: "2 integrations need re-authentication",
      visible: true,
    };
    render(<ComposerIntegrationReauthChip />);

    expect(screen.getByText("2 integrations need re-authentication")).toBeTruthy();
  });

  it("opens Settings at the user integrations section on click", () => {
    mocks.reauthState = {
      providerNames: ["Linear"],
      label: "Linear needs re-authentication",
      visible: true,
    };
    render(<ComposerIntegrationReauthChip />);

    fireEvent.click(screen.getByRole("button"));

    expect(mocks.navigate).toHaveBeenCalledWith("/settings?section=integrations");
  });
});
