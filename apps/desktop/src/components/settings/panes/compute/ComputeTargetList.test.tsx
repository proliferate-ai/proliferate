// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DirectRuntimeConnectionState } from "@/lib/domain/compute/direct-runtime";
import type { ComputeTargetSummary } from "@/lib/domain/compute/target-types";
import { ComputeTargetList } from "./ComputeTargetList";

function target(overrides: Partial<ComputeTargetSummary> = {}): ComputeTargetSummary {
  return {
    id: "t-1",
    displayName: "Homelab",
    kind: "ssh",
    status: "online",
    ownerScope: "personal",
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

function renderList(overrides: {
  targets?: ComputeTargetSummary[];
  cloudTargets?: ComputeTargetSummary[];
  attachStates?: Record<string, DirectRuntimeConnectionState>;
  loopbackState?: DirectRuntimeConnectionState;
} = {}) {
  const {
    targets = [],
    cloudTargets = [],
    attachStates = {},
    loopbackState = "attached",
  } = overrides;
  return render(
    <ComputeTargetList
      targets={targets}
      cloudTargets={cloudTargets}
      appearancePreferences={{}}
      selectedTargetId={null}
      loading={false}
      loopbackDisplayName="Pablos-MacBook-Pro"
      getAttachState={(targetId) =>
        targetId === null ? loopbackState : attachStates[targetId] ?? "detached"}
      onSelectTarget={vi.fn()}
      onAddSshTarget={vi.fn()}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe("ComputeTargetList", () => {
  it("renders This Mac first, before every enrolled target", () => {
    renderList({
      targets: [target({ id: "t-1", displayName: "Homelab" })],
      attachStates: { "t-1": "attached" },
    });

    const thisMac = screen.getByTestId("this-mac-row");
    expect(within(thisMac).getByText("Pablos-MacBook-Pro")).toBeTruthy();
    const homelabRow = screen.getByText("Homelab");
    expect(
      thisMac.compareDocumentPosition(homelabRow)
        & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows This Mac's attach state from the harness connection", () => {
    renderList({ loopbackState: "connecting" });
    const thisMac = screen.getByTestId("this-mac-row");
    expect(within(thisMac).getByText("Connecting")).toBeTruthy();
  });

  it("chips each direct target with its attach state alongside enrollment status", () => {
    renderList({
      targets: [
        target({ id: "t-1", displayName: "Homelab" }),
        target({ id: "t-2", displayName: "Studio", status: "offline" }),
      ],
      attachStates: { "t-1": "attached" },
    });

    // This Mac (loopback) + t-1 both read attached.
    expect(screen.getAllByText("Attached").length).toBe(2);
    // t-2 has no attach machine entry -> detached.
    expect(screen.getAllByText("Detached").length).toBe(1);
    // Enrollment status stays its own claim.
    expect(screen.getByText("Online")).toBeTruthy();
    expect(screen.getByText("Offline")).toBeTruthy();
  });

  it("keeps cloud targets in their own section without attach chips", () => {
    renderList({
      targets: [target({ id: "t-1" })],
      cloudTargets: [
        target({ id: "c-1", displayName: "Managed pool", kind: "managed_cloud" }),
      ],
      attachStates: { "t-1": "attached" },
    });

    expect(screen.getByText("Cloud")).toBeTruthy();
    expect(screen.getByText("Managed pool")).toBeTruthy();
    // One attach chip for the ssh row, one for This Mac — none for cloud.
    expect(screen.getAllByText("Attached").length).toBe(2);
  });
});
