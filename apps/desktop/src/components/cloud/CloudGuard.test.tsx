// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CloudGuard, type CloudGateFlags } from "./CloudGuard";

vi.mock("@/components/settings/panes/CloudUnavailablePane", () => ({
  CloudUnavailablePane: () => <div>unavailable</div>,
}));
vi.mock("@/components/settings/panes/CloudSignInRequiredPane", () => ({
  CloudSignInRequiredPane: () => <div>sign-in-required</div>,
}));
vi.mock("@/components/settings/panes/CloudAuthUnavailablePane", () => ({
  CloudAuthUnavailablePane: () => <div>auth-unavailable</div>,
}));

const availability = vi.hoisted(() => ({
  value: {
    cloudEnabled: true,
    cloudActive: true,
    cloudSignInChecking: false,
    cloudSignInAvailable: false,
  } as CloudGateFlags,
}));

vi.mock("@/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => availability.value,
}));

afterEach(() => cleanup());

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

  it("renders sign-in-required while checking", () => {
    render(<CloudGuard flags={flags({ cloudSignInChecking: true })}>child</CloudGuard>);
    expect(screen.queryByText("sign-in-required")).not.toBeNull();
  });

  it("renders sign-in-required when sign-in is available", () => {
    render(<CloudGuard flags={flags({ cloudSignInAvailable: true })}>child</CloudGuard>);
    expect(screen.queryByText("sign-in-required")).not.toBeNull();
  });

  it("renders auth-unavailable otherwise", () => {
    render(<CloudGuard flags={flags({})}>child</CloudGuard>);
    expect(screen.queryByText("auth-unavailable")).not.toBeNull();
  });

  it("falls back to the availability hook when no flags are passed", () => {
    availability.value = flags({ cloudEnabled: false });
    render(<CloudGuard>child</CloudGuard>);
    expect(screen.queryByText("unavailable")).not.toBeNull();
  });
});
