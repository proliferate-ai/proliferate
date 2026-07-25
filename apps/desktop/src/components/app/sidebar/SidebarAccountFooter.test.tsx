/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarAccountFooter } from "./SidebarAccountFooter";

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useUsageSummary: () => ({ data: null }),
}));

vi.mock("@proliferate/ui/primitives/PopoverButton", () => ({
  POPOVER_SURFACE_CLASS: "popover-surface",
  PopoverButton: ({
    children,
    trigger,
  }: {
    children: (close: () => void) => ReactNode;
    trigger: ReactNode;
  }) => (
    <div>
      {trigger}
      {children(() => {})}
    </div>
  ),
}));

vi.mock("@proliferate/ui/primitives/PopoverMenuItem", () => ({
  PopoverMenuItem: ({
    label,
    onClick,
  }: {
    label: ReactNode;
    onClick?: () => void;
  }) => <button type="button" onClick={onClick}>{label}</button>,
}));

vi.mock("@proliferate/ui/primitives/ConfirmationDialog", () => ({
  ConfirmationDialog: () => null,
}));

vi.mock("@/components/organizations/OrganizationAvatar", () => ({
  OrganizationAvatar: () => null,
}));

vi.mock("./OrganizationSwitchDialog", () => ({
  OrganizationSwitchDialog: () => null,
}));

vi.mock("./SidebarAppVersionRow", () => ({
  SidebarAppVersionRow: () => null,
}));

vi.mock("./SidebarHelpSection", () => ({
  SidebarHelpSection: () => null,
}));

vi.mock("./SidebarConsumptionCard", () => ({
  ConsumptionCard: () => null,
}));

vi.mock("@/hooks/capabilities/derived/use-app-capabilities", () => ({
  useAppCapabilities: () => ({
    billingEnabled: true,
    isSelfManaged: false,
    usageMeteringEnabled: false,
  }),
}));

vi.mock("@/hooks/capabilities/derived/use-web-app-target", () => ({
  useWebAppTarget: () => ({ available: false, baseUrl: null }),
}));

vi.mock("@/hooks/app/workflows/use-app-sidebar-sign-out-action", () => ({
  useAppSidebarSignOutAction: () => vi.fn(),
}));

vi.mock("@/hooks/cloud/facade/use-cloud-billing", () => ({
  useCloudBilling: () => ({ data: { isPaidCloud: true } }),
}));

vi.mock("@/hooks/access/cloud/organizations/use-current-user-organization-invitations", () => ({
  useCurrentUserOrganizationInvitations: () => ({ data: { invitations: [] } }),
}));

vi.mock("@/hooks/access/cloud/organizations/use-organization-actions", () => ({
  useOrganizationActions: () => ({
    acceptCurrentInvitation: vi.fn(),
    acceptingCurrentInvitation: false,
  }),
}));

vi.mock("@/hooks/organizations/workflows/use-joined-organization-activation", () => ({
  useJoinedOrganizationActivation: () => ({
    activateJoinedOrganization: vi.fn(),
    activatingJoinedOrganization: false,
  }),
}));

vi.mock("@/hooks/organizations/facade/use-active-organization", () => ({
  useActiveOrganization: () => ({
    activeOrganization: { id: "org-1", name: "Acme" },
    activeOrganizationId: "org-1",
    organizations: [],
    organizationsQuery: { isError: false, isLoading: false },
    setActiveOrganizationId: vi.fn(),
  }),
}));

vi.mock("@/hooks/support/workflows/use-open-support-report-window", () => ({
  useOpenSupportReportWindow: () => ({
    disabledReason: null,
    openBug: vi.fn(),
    openFeature: vi.fn(),
  }),
}));

vi.mock("@/hooks/support/derived/use-support-menu-action", () => ({
  useSupportMenuAction: () => ({ kind: "none" }),
}));

vi.mock("@/hooks/access/tauri/use-shell-actions", () => ({
  useTauriShellActions: () => ({ openExternal: vi.fn() }),
}));

vi.mock("@/stores/auth/auth-store", () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => selector({
    status: "authenticated",
    user: { display_name: "Ada", email: "ada@example.com" },
  }),
}));

vi.mock("@/stores/shortcuts/keyboard-shortcuts-dialog-store", () => ({
  useKeyboardShortcutsDialogStore: (selector: (state: unknown) => unknown) => selector({
    setOpen: vi.fn(),
  }),
}));

vi.mock("@/stores/toast/toast-store", () => ({
  useToastStore: (selector: (state: unknown) => unknown) => selector({
    show: vi.fn(),
  }),
}));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

describe("SidebarAccountFooter settings entry points", () => {
  afterEach(() => {
    cleanup();
  });

  it("opens Plan in Billing and account-menu Settings in Account", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <SidebarAccountFooter />
        <LocationProbe />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Plan" }));
    expect(screen.getByTestId("location").textContent)
      .toBe("/settings?section=billing");

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByTestId("location").textContent)
      .toBe("/settings?section=account");
  });
});
