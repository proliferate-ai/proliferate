// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CloudIntegrationView } from "@/lib/domain/cloud/integrations";
import { IntegrationRow } from "./IntegrationRow";

function makeIntegration(overrides: Partial<CloudIntegrationView> = {}): CloudIntegrationView {
  return {
    definitionId: "def-1",
    namespace: "linear",
    displayName: "Linear",
    description: "Issue tracking",
    authKind: "oauth2",
    connectSchema: { secretFields: [], settingsFields: [] },
    accountId: null,
    health: "needs_auth",
    effectiveEnabled: true,
    policyEnabled: null,
    accountEnabled: null,
    tokenExpiresAt: null,
    toolCount: null,
    lastErrorCode: null,
    ...overrides,
  };
}

function renderRow(
  integration: CloudIntegrationView,
  overrides: Partial<Parameters<typeof IntegrationRow>[0]> = {},
) {
  return render(
    <IntegrationRow
      integration={integration}
      oauthPending={false}
      connecting={false}
      cancellingOauth={false}
      onConnect={vi.fn()}
      onCancelOauth={vi.fn()}
      onRequestDisconnect={vi.fn()}
      {...overrides}
    />,
  );
}

describe("IntegrationRow", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows name, auth kind, and a Connect action for unconnected integrations", () => {
    renderRow(makeIntegration());

    expect(screen.getByText("Linear")).toBeTruthy();
    expect(screen.getByText("OAuth")).toBeTruthy();
    expect(screen.getByText("Not connected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
  });

  it("shows the tool count and only Disconnect for a healthy connection", () => {
    renderRow(makeIntegration({ accountId: "acc-1", health: "ready", toolCount: 7 }));

    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.getByText("7 tools")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
  });

  it("offers Reconnect alongside Disconnect when reauth is needed", () => {
    renderRow(makeIntegration({ accountId: "acc-1", health: "needs_reauth" }));

    expect(screen.getByText("Reconnect required")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
  });

  it("blocks connecting integrations disabled by the organization", () => {
    renderRow(makeIntegration({ health: "disabled_by_org" }));

    expect(screen.getByText("Disabled by org")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
  });

  it("shows the pending browser handoff inline within the row, with a cancel action", () => {
    const onCancelOauth = vi.fn();
    renderRow(makeIntegration(), { oauthPending: true, onCancelOauth });

    // The pending state renders in the row's action cell — the rest of the
    // row (and the list) stays put, it is not a pane-level replacement.
    expect(screen.getByText("Linear")).toBeTruthy();
    expect(screen.getByText("OAuth")).toBeTruthy();
    expect(screen.getByText("Waiting for browser...")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
    screen.getByRole("button", { name: "Cancel" }).click();
    expect(onCancelOauth).toHaveBeenCalledTimes(1);
  });

  it("swaps Connect to a disabled inline Connecting state in the same row", () => {
    renderRow(makeIntegration(), { connecting: true });

    // Row content and health badge stay rendered; only the button label flips.
    expect(screen.getByText("Linear")).toBeTruthy();
    expect(screen.getByText("Not connected")).toBeTruthy();
    const button = screen.getByRole<HTMLButtonElement>("button", {
      name: "Connecting...",
    });
    expect(button.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
  });

  it("keeps a fixed action-button width across connect states", () => {
    // Connect, Connecting..., and the OAuth-pending Cancel all share the same
    // min-width, so state changes swap labels in place instead of reflowing
    // the row.
    const idle = renderRow(makeIntegration());
    expect(
      screen.getByRole("button", { name: "Connect" }).className,
    ).toContain("min-w-24");
    idle.unmount();

    const connecting = renderRow(makeIntegration(), { connecting: true });
    expect(
      screen.getByRole("button", { name: "Connecting..." }).className,
    ).toContain("min-w-24");
    connecting.unmount();

    renderRow(makeIntegration(), { oauthPending: true });
    expect(
      screen.getByRole("button", { name: "Cancel" }).className,
    ).toContain("min-w-24");
  });
});
