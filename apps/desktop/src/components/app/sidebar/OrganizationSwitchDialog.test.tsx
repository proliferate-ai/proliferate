// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizationRecord } from "@/lib/domain/organizations/organization-records";
import { OrganizationSwitchDialog } from "./OrganizationSwitchDialog";
import { useToastStore } from "@/stores/toast/toast-store";

const switchMock = vi.fn<(organizationId: string) => Promise<void>>();

vi.mock("@/hooks/organizations/workflows/use-organization-switch-action", () => ({
  useOrganizationSwitchAction: () => ({
    switchOrganization: switchMock,
    switchingOrganization: false,
  }),
}));

// Stub the modal primitive with a minimal confirm/cancel surface so the test
// exercises the dialog's onConfirm wiring rather than Radix portal internals.
vi.mock("@proliferate/ui/primitives/ConfirmationDialog", () => ({
  ConfirmationDialog: ({
    open,
    confirmLabel,
    onConfirm,
    onClose,
  }: {
    open: boolean;
    confirmLabel: string;
    onConfirm: () => void;
    onClose: () => void;
  }) =>
    open ? (
      <div>
        <button type="button" onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" onClick={onClose}>
          cancel
        </button>
      </div>
    ) : null,
}));

function organization(id: string, name: string): OrganizationRecord {
  return { id, name } as OrganizationRecord;
}

describe("OrganizationSwitchDialog", () => {
  beforeEach(() => {
    switchMock.mockReset();
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    cleanup();
  });

  it("closes the dialog after a successful switch without a toast", async () => {
    switchMock.mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <OrganizationSwitchDialog target={organization("org-2", "Acme")} onClose={onClose} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Switch organization" }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(switchMock).toHaveBeenCalledWith("org-2");
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("surfaces an error toast and keeps the dialog open when the switch fails", async () => {
    switchMock.mockRejectedValue(new Error("worker teardown failed"));
    const onClose = vi.fn();
    render(
      <OrganizationSwitchDialog target={organization("org-2", "Acme")} onClose={onClose} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Switch organization" }));

    await waitFor(() => {
      expect(useToastStore.getState().toasts).toHaveLength(1);
    });
    const [toast] = useToastStore.getState().toasts;
    expect(toast.message).toBe("worker teardown failed");
    expect(toast.type).toBe("error");
    // The switch failed, so the dialog stays open for a retry.
    expect(onClose).not.toHaveBeenCalled();
  });
});
