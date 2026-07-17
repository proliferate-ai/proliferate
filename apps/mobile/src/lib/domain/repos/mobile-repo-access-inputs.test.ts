import { describe, expect, it } from "vitest";

import {
  resolveMobileInstallationTarget,
  synthesizeListAuthority,
} from "./mobile-repo-access-inputs";

describe("synthesizeListAuthority", () => {
  it("returns null while user authorization is unknown", () => {
    expect(
      synthesizeListAuthority({
        userAuthorization: "unknown",
        installation: "unknown",
        requiresInstallation: true,
      }),
    ).toBeNull();
  });

  it("maps needs_authorize to missing_user_authorization", () => {
    expect(
      synthesizeListAuthority({
        userAuthorization: "needs_authorize",
        installation: "unknown",
        requiresInstallation: true,
      }),
    ).toEqual({ authorized: false, status: "missing_user_authorization" });
  });

  it("maps needs_reauthorize to expired_user_authorization", () => {
    expect(
      synthesizeListAuthority({
        userAuthorization: "needs_reauthorize",
        installation: "installed",
        requiresInstallation: true,
      }),
    ).toEqual({ authorized: false, status: "expired_user_authorization" });
  });

  it("returns null while installation is unknown after auth", () => {
    expect(
      synthesizeListAuthority({
        userAuthorization: "connected",
        installation: "unknown",
        requiresInstallation: true,
      }),
    ).toBeNull();
  });

  it("maps a missing installation to missing_installation", () => {
    expect(
      synthesizeListAuthority({
        userAuthorization: "connected",
        installation: "missing",
        requiresInstallation: true,
      }),
    ).toEqual({ authorized: false, status: "missing_installation" });
  });

  it("is ready when authorized and installed", () => {
    expect(
      synthesizeListAuthority({
        userAuthorization: "connected",
        installation: "installed",
        requiresInstallation: true,
      }),
    ).toEqual({ authorized: true, status: "ready" });
  });

  it("skips the installation gate when no org requires it", () => {
    expect(
      synthesizeListAuthority({
        userAuthorization: "connected",
        installation: "unknown",
        requiresInstallation: false,
      }),
    ).toEqual({ authorized: true, status: "ready" });
  });
});

describe("resolveMobileInstallationTarget", () => {
  it("returns a null org for a personal-only user", () => {
    expect(resolveMobileInstallationTarget([])).toEqual({
      organizationId: null,
      canManageInstallation: false,
    });
  });

  it("prefers an org the member can manage", () => {
    const target = resolveMobileInstallationTarget([
      { id: "org-member", role: "member" },
      { id: "org-admin", role: "admin" },
    ]);
    expect(target).toEqual({ organizationId: "org-admin", canManageInstallation: true });
  });

  it("falls back to the first org as request-only when none is manageable", () => {
    const target = resolveMobileInstallationTarget([
      { id: "org-a", role: "member" },
      { id: "org-b", role: null },
    ]);
    expect(target).toEqual({ organizationId: "org-a", canManageInstallation: false });
  });
});
