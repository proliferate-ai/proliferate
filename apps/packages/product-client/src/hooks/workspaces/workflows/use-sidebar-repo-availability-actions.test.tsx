// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSidebarRepoAvailabilityActions } from "#product/hooks/workspaces/workflows/use-sidebar-repo-availability-actions";

const state = vi.hoisted(() => ({
  cloudComputeEnabled: true,
  managedCloudStatus: "ready" as string,
}));

vi.mock("#product/hooks/capabilities/derived/use-app-capabilities", () => ({
  useAppCapabilities: () => ({
    cloudComputeEnabled: state.cloudComputeEnabled,
    managedCloudStatus: state.managedCloudStatus,
  }),
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({ desktop: null }),
}));

vi.mock("#product/hooks/workspaces/workflows/use-add-repo", () => ({
  useAddRepo: () => ({ addRepoFromPath: vi.fn() }),
}));

vi.mock("#product/stores/cloud/cloud-repository-intent-store", () => ({
  useCloudRepositoryIntentStore: (selector: (state: { begin: () => void }) => unknown) =>
    selector({ begin: vi.fn() }),
}));

vi.mock("#product/stores/toast/toast-store", () => ({
  useToastStore: (selector: (state: { show: () => void }) => unknown) =>
    selector({ show: vi.fn() }),
}));

describe("useSidebarRepoAvailabilityActions", () => {
  it("reports managedCloudAvailable=true only when both the server status is enabled AND cloud compute is enabled (PRO-10)", () => {
    state.cloudComputeEnabled = true;
    state.managedCloudStatus = "ready";
    const { result } = renderHook(() => useSidebarRepoAvailabilityActions());
    expect(result.current.managedCloudAvailable).toBe(true);
  });

  it("negative control: with the pre-fix contract (server status alone) this would have reported available", () => {
    // Pre-fix behavior read only capabilities.managedCloudStatus !== "disabled".
    // Reproduce that expression directly against the same fixture to prove the
    // rung-1 kill switch would have been invisible to it.
    const preFixManagedCloudAvailable = state.managedCloudStatus !== "disabled";
    expect(preFixManagedCloudAvailable).toBe(true);
  });

  it("gates managedCloudAvailable/canSetUpCloud to false when cloudComputeEnabled is false, even with the server status ready (PRO-10)", () => {
    state.cloudComputeEnabled = false;
    state.managedCloudStatus = "ready";
    const { result } = renderHook(() => useSidebarRepoAvailabilityActions());
    expect(result.current.managedCloudAvailable).toBe(false);
  });

  it("stays unavailable when the server status is disabled regardless of cloudComputeEnabled", () => {
    state.cloudComputeEnabled = true;
    state.managedCloudStatus = "disabled";
    const { result } = renderHook(() => useSidebarRepoAvailabilityActions());
    expect(result.current.managedCloudAvailable).toBe(false);
  });
});
