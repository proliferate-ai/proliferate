// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpgradeGateDialog } from "@/components/billing/UpgradeGateDialog";
import { TEAM_UPGRADE_GATE_COPY } from "@/copy/billing/upgrade-gate-copy";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("UpgradeGateDialog", () => {
  it("shows the upgrade benefits before confirming checkout", () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();

    render(
      <UpgradeGateDialog
        open
        copy={TEAM_UPGRADE_GATE_COPY}
        contextLabel="Team"
        contextValue="Research"
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Upgrade to Team" })).toBeTruthy();
    expect(screen.getByText("Research")).toBeTruthy();
    expect(screen.getByText("Members, invitations, and admin roles")).toBeTruthy();
    expect(screen.getByText("Organization cloud work, Slack sessions, and workflows")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Continue to checkout" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("keeps the blocking action disabled while checkout is starting", () => {
    render(
      <UpgradeGateDialog
        open
        copy={TEAM_UPGRADE_GATE_COPY}
        loading
        error="Checkout is not available."
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Continue to checkout" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Not now" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Checkout is not available.")).toBeTruthy();
  });
});
