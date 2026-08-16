// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";

import { renderWithProductHost } from "#product/test/product-host-test-utils";
import { RepoScopeEmptyState } from "#product/components/settings/panes/repo/RepoScopeStates";

/**
 * Cloud-culling acceptance regression (PRO-10, FR-2/FR-3, Rung 6).
 *
 * The repo-scope empty state is reachable on desktop: SettingsScreen forces the
 * repo context to "local" off desktop, but the local-context panes still render
 * this empty state. Its copy must not advertise a "runs in Proliferate Cloud"
 * repo on desktop, where the add-repo flow only registers a local checkout.
 */
describe("RepoScopeEmptyState cloud copy host-gating", () => {
  afterEach(() => cleanup());

  const callbacks = {
    onSelectRepo: () => {},
    onSelectCloudEnvironment: () => {},
  };

  it("does not mention Proliferate Cloud on desktop", () => {
    renderWithProductHost(<RepoScopeEmptyState {...callbacks} />, {
      overrides: { surface: "desktop" },
    });
    expect(screen.queryByText(/proliferate cloud/i)).toBeNull();
    expect(screen.getByText(/add a local checkout to get started/i)).toBeTruthy();
  });

  it("keeps the cloud copy on web", () => {
    renderWithProductHost(<RepoScopeEmptyState {...callbacks} />, {
      overrides: { surface: "web" },
    });
    expect(screen.getByText(/runs in Proliferate Cloud/i)).toBeTruthy();
  });
});
