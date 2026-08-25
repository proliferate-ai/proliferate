// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { renderSettingsSection } from "#product/components/settings/screen/render-settings-section";
import { type SettingsSection } from "#product/config/settings";
import { type RepoScopeSelection } from "#product/lib/domain/settings/repo-scope-selection";

// The six control-plane sections gated through CloudGuard. Each pane renders an
// identifiable marker so we can assert it mounted (rather than a gate pane).
vi.mock("#product/components/settings/panes/agents/api-keys/ApiKeysPane", () => ({
  ApiKeysPane: () => <div>pane:agent-api-keys</div>,
}));
vi.mock("#product/components/settings/panes/PersonalSecretsPane", () => ({
  PersonalSecretsPane: () => <div>pane:personal-secrets</div>,
}));
vi.mock("#product/components/settings/panes/OrganizationSecretsPane", () => ({
  OrganizationSecretsPane: () => <div>pane:organization-secrets</div>,
}));
vi.mock("#product/components/settings/panes/OrganizationIntegrationsPane", () => ({
  OrganizationIntegrationsPane: () => <div>pane:organization-integrations</div>,
}));
vi.mock("#product/components/settings/panes/OrganizationModelPolicyPane", () => ({
  OrganizationModelPolicyPane: () => <div>pane:organization-model-policy</div>,
}));

// CloudGuard's fallback panes — the "gated" outcomes we must NOT see when the
// control plane is reachable and the user is authenticated.
vi.mock("#product/components/settings/panes/CloudUnavailablePane", () => ({
  CloudUnavailablePane: () => <div>gate:unavailable</div>,
}));
vi.mock("#product/components/settings/panes/CloudNotConfiguredPane", () => ({
  CloudNotConfiguredPane: () => <div>gate:not-configured</div>,
}));
vi.mock("#product/components/settings/panes/CloudSignInRequiredPane", () => ({
  CloudSignInRequiredPane: () => <div>gate:sign-in-required</div>,
}));
vi.mock("#product/components/settings/panes/CloudAuthUnavailablePane", () => ({
  CloudAuthUnavailablePane: () => <div>gate:auth-unavailable</div>,
}));

interface AvailabilityShape {
  controlPlaneReachable: boolean;
  cloudActive: boolean;
  cloudSignInChecking: boolean;
  cloudSignInAvailable: boolean;
  authStatus: "loading" | "anonymous" | "authenticated";
  cloudComputeEnabled: boolean;
}

const availability = vi.hoisted(() => ({
  value: {
    controlPlaneReachable: true,
    cloudActive: false,
    cloudSignInChecking: false,
    cloudSignInAvailable: true,
    authStatus: "authenticated",
    cloudComputeEnabled: false,
  } as AvailabilityShape,
}));

// CloudGuard reads the true-cause fields (authStatus, cloudComputeEnabled) from
// the availability hook even when the settings screen threads explicit flags.
vi.mock("#product/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => availability.value,
}));

const CONTROL_PLANE_SECTIONS: { section: SettingsSection; marker: string }[] = [
  { section: "agent-api-keys", marker: "pane:agent-api-keys" },
  { section: "personal-secrets", marker: "pane:personal-secrets" },
  { section: "organization-secrets", marker: "pane:organization-secrets" },
  { section: "organization-integrations", marker: "pane:organization-integrations" },
  { section: "organization-model-policy", marker: "pane:organization-model-policy" },
];

const repoSelection: RepoScopeSelection = {
  repository: null,
  context: null,
} as unknown as RepoScopeSelection;

const noop = () => {};

function renderSection(
  section: SettingsSection,
  opts: { controlPlaneReachable: boolean; authenticated: boolean },
) {
  return render(
    <>
      {renderSettingsSection(
        section,
        repoSelection,
        opts.controlPlaneReachable,
        // cloudActive threads the compute-inclusive signal; the fix makes the
        // control-plane sections ignore it. Force it false so any regression
        // that re-couples them to compute would gate.
        false,
        false,
        true,
        opts.authenticated,
        "none" as never,
        noop,
        noop,
        noop,
        noop,
      )}
    </>,
  );
}

afterEach(() => {
  cleanup();
  availability.value = {
    controlPlaneReachable: true,
    cloudActive: false,
    cloudSignInChecking: false,
    cloudSignInAvailable: true,
    authStatus: "authenticated",
    cloudComputeEnabled: false,
  };
});

describe("renderSettingsSection control-plane gating (PRO-10)", () => {
  it("renders every control-plane section enabled when reachable + authenticated even though cloud compute is disabled", () => {
    // Regression: rung 1 flipped CLOUD_COMPUTE_TEMPORARILY_DISABLED on. These
    // control-plane features (ADR FM6/Q9) must stay available.
    availability.value.cloudComputeEnabled = false;
    availability.value.authStatus = "authenticated";
    for (const { section, marker } of CONTROL_PLANE_SECTIONS) {
      renderSection(section, { controlPlaneReachable: true, authenticated: true });
      expect(screen.queryByText(marker)).not.toBeNull();
      expect(screen.queryByText("gate:not-configured")).toBeNull();
      expect(screen.queryByText("gate:sign-in-required")).toBeNull();
      expect(screen.queryByText("gate:unavailable")).toBeNull();
      cleanup();
    }
  });

  it("gates every control-plane section behind the unreachable pane when the control plane is unreachable", () => {
    availability.value.controlPlaneReachable = false;
    availability.value.authStatus = "authenticated";
    for (const { section, marker } of CONTROL_PLANE_SECTIONS) {
      renderSection(section, { controlPlaneReachable: false, authenticated: true });
      expect(screen.queryByText(marker)).toBeNull();
      expect(screen.queryByText("gate:unavailable")).not.toBeNull();
      cleanup();
    }
  });

  it("gates every control-plane section behind sign-in when reachable but unauthenticated", () => {
    availability.value.authStatus = "anonymous";
    availability.value.cloudSignInAvailable = true;
    for (const { section, marker } of CONTROL_PLANE_SECTIONS) {
      renderSection(section, { controlPlaneReachable: true, authenticated: false });
      expect(screen.queryByText(marker)).toBeNull();
      expect(screen.queryByText("gate:sign-in-required")).not.toBeNull();
      cleanup();
    }
  });
});
