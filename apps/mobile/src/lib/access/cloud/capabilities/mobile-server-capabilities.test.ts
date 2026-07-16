import { describe, expect, it } from "vitest";

import {
  DISABLED_MOBILE_CAPABILITIES,
  parseMobileMetaCapabilities,
  parseMobileServerCapabilities,
} from "./mobile-server-capabilities";

describe("parseMobileServerCapabilities", () => {
  it("reads explicit v2 statuses and display name", () => {
    const parsed = parseMobileServerCapabilities({
      contractVersion: 2,
      githubRepositoryAccess: {
        status: "ready",
        provider: "github_app",
        displayName: "Acme Cloud",
      },
      managedCloud: { status: "ready", repositoryAuthority: "github_app" },
    });
    expect(parsed).toEqual({
      githubRepositoryAccess: "ready",
      managedCloud: "ready",
      githubRepositoryAccessDisplayName: "Acme Cloud",
    });
  });

  it("keeps managed-Cloud and GitHub access independent", () => {
    const parsed = parseMobileServerCapabilities({
      contractVersion: 2,
      githubRepositoryAccess: { status: "ready", provider: "github_app", displayName: null },
      managedCloud: { status: "disabled", repositoryAuthority: null },
    });
    expect(parsed.githubRepositoryAccess).toBe("ready");
    expect(parsed.managedCloud).toBe("disabled");
  });

  it("fails closed for a malformed declared v2 status", () => {
    const parsed = parseMobileServerCapabilities({
      contractVersion: 2,
      githubRepositoryAccess: { status: "totally-bogus" },
      managedCloud: { status: 42 },
    });
    expect(parsed.githubRepositoryAccess).toBe("disabled");
    expect(parsed.managedCloud).toBe("disabled");
  });

  it("fails closed when a v2 object is absent", () => {
    const parsed = parseMobileServerCapabilities({ contractVersion: 2 });
    expect(parsed.githubRepositoryAccess).toBe("disabled");
    expect(parsed.managedCloud).toBe("disabled");
  });

  it("projects a v1 (pre-v2) cloudWorkspaces=true contract as ready", () => {
    const parsed = parseMobileServerCapabilities({
      contractVersion: 1,
      cloudWorkspaces: true,
    });
    expect(parsed.githubRepositoryAccess).toBe("ready");
    expect(parsed.managedCloud).toBe("ready");
  });

  it("projects a v1 cloudWorkspaces=false contract as disabled", () => {
    const parsed = parseMobileServerCapabilities({
      contractVersion: 1,
      cloudWorkspaces: false,
    });
    expect(parsed).toEqual({
      githubRepositoryAccess: "disabled",
      managedCloud: "disabled",
      githubRepositoryAccessDisplayName: null,
    });
  });

  it("projects a legacy contract with no version from cloudWorkspaces", () => {
    const parsed = parseMobileServerCapabilities({ cloudWorkspaces: true });
    expect(parsed.managedCloud).toBe("ready");
  });

  it("returns fully-disabled for a non-object payload", () => {
    expect(parseMobileServerCapabilities(null)).toEqual(DISABLED_MOBILE_CAPABILITIES);
    expect(parseMobileServerCapabilities("nope")).toEqual(DISABLED_MOBILE_CAPABILITIES);
  });
});

describe("parseMobileMetaCapabilities", () => {
  it("extracts the capabilities block from a /meta body", () => {
    const parsed = parseMobileMetaCapabilities({
      serverVersion: "1.2.3",
      capabilities: {
        contractVersion: 2,
        githubRepositoryAccess: { status: "operator_configuration_required" },
        managedCloud: { status: "ready" },
      },
    });
    expect(parsed.githubRepositoryAccess).toBe("operator_configuration_required");
    expect(parsed.managedCloud).toBe("ready");
  });

  it("fails closed for a non-object body", () => {
    expect(parseMobileMetaCapabilities(undefined)).toEqual(DISABLED_MOBILE_CAPABILITIES);
  });
});
