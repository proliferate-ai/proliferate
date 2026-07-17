// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CloudGuard, type CloudGateFlags } from "#product/components/cloud/CloudGuard";

vi.mock("#product/components/settings/panes/CloudUnavailablePane", () => ({
  CloudUnavailablePane: () => <div>unavailable</div>,
}));
vi.mock("#product/components/settings/panes/CloudNotConfiguredPane", () => ({
  CloudNotConfiguredPane: () => <div>not-configured</div>,
}));
vi.mock("#product/components/settings/panes/CloudSignInRequiredPane", () => ({
  CloudSignInRequiredPane: () => <div>sign-in-required</div>,
}));
vi.mock("#product/components/settings/panes/CloudAuthUnavailablePane", () => ({
  CloudAuthUnavailablePane: () => <div>auth-unavailable</div>,
}));

// The availability hook's full shape. CloudGuard always reads the true-cause
// fields (authStatus, cloudComputeEnabled) from here, even when flags are
// passed for the four legacy fields.
interface AvailabilityShape extends CloudGateFlags {
  authStatus: "loading" | "anonymous" | "authenticated";
  cloudComputeEnabled: boolean;
}

const availability = vi.hoisted(() => ({
  value: {
    cloudEnabled: true,
    cloudActive: true,
    cloudSignInChecking: false,
    cloudSignInAvailable: false,
    authStatus: "authenticated",
    cloudComputeEnabled: true,
  } as AvailabilityShape,
}));

vi.mock("#product/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => availability.value,
}));

afterEach(() => {
  cleanup();
  availability.value = {
    cloudEnabled: true,
    cloudActive: true,
    cloudSignInChecking: false,
    cloudSignInAvailable: false,
    authStatus: "authenticated",
    cloudComputeEnabled: true,
  };
});

function setAvailability(overrides: Partial<AvailabilityShape>) {
  availability.value = { ...availability.value, ...overrides };
}

function flags(overrides: Partial<CloudGateFlags>): CloudGateFlags {
  return {
    cloudEnabled: true,
    cloudActive: false,
    cloudSignInChecking: false,
    cloudSignInAvailable: false,
    ...overrides,
  };
}

describe("CloudGuard", () => {
  it("renders CloudUnavailablePane when cloud is disabled", () => {
    render(<CloudGuard flags={flags({ cloudEnabled: false })}>child</CloudGuard>);
    expect(screen.queryByText("unavailable")).not.toBeNull();
  });

  it("renders children when cloud is active", () => {
    render(<CloudGuard flags={flags({ cloudActive: true })}>child</CloudGuard>);
    expect(screen.queryByText("child")).not.toBeNull();
  });

  it("renders the operator pane (NOT sign-in) for a signed-in user when cloud compute is not configured (PR2-GATING-01)", () => {
    // Signed in, cloud enabled, but the operator hasn't configured compute.
    // sign-in flags could still be truthy (a reachable control plane always
    // offers sign-in) — the operator cause must win, and NO sign-in CTA shows.
    setAvailability({ authStatus: "authenticated", cloudComputeEnabled: false });
    render(
      <CloudGuard flags={flags({ cloudActive: false, cloudSignInAvailable: true })}>
        child
      </CloudGuard>,
    );
    expect(screen.queryByText("not-configured")).not.toBeNull();
    expect(screen.queryByText("sign-in-required")).toBeNull();
    expect(screen.queryByText("child")).toBeNull();
  });

  it("renders sign-in-required for an anonymous user while checking", () => {
    setAvailability({ authStatus: "anonymous", cloudComputeEnabled: false });
    render(<CloudGuard flags={flags({ cloudSignInChecking: true })}>child</CloudGuard>);
    expect(screen.queryByText("sign-in-required")).not.toBeNull();
  });

  it("renders sign-in-required for an anonymous user when sign-in is available", () => {
    setAvailability({ authStatus: "anonymous", cloudComputeEnabled: false });
    render(<CloudGuard flags={flags({ cloudSignInAvailable: true })}>child</CloudGuard>);
    expect(screen.queryByText("sign-in-required")).not.toBeNull();
  });

  it("renders auth-unavailable otherwise (anonymous, no sign-in path)", () => {
    setAvailability({ authStatus: "anonymous", cloudComputeEnabled: false });
    render(<CloudGuard flags={flags({})}>child</CloudGuard>);
    expect(screen.queryByText("auth-unavailable")).not.toBeNull();
  });

  it("falls back to the availability hook when no flags are passed", () => {
    setAvailability({ cloudEnabled: false, cloudActive: false });
    render(<CloudGuard>child</CloudGuard>);
    expect(screen.queryByText("unavailable")).not.toBeNull();
  });
});
