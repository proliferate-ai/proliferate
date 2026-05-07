import { describe, expect, it } from "vitest";
import { formatCloudWorkspaceSettingsError } from "./cloud-workspace-settings";

describe("formatCloudWorkspaceSettingsError", () => {
  it("returns null when nothing is set", () => {
    expect(
      formatCloudWorkspaceSettingsError({
        credentialError: null,
        fileError: null,
        setupError: null,
        lastApplyError: null,
      }),
    ).toBeNull();
  });

  it("prefixes credential errors", () => {
    expect(
      formatCloudWorkspaceSettingsError({
        credentialError: new Error("nope"),
        fileError: null,
        setupError: null,
        lastApplyError: null,
      }),
    ).toBe("Credential sync failed: nope");
  });

  it("maps workspace_not_ready credential errors to a friendly readiness message", () => {
    const error = new Error("workspace is not ready") as Error & { code: string };
    error.code = "workspace_not_ready";

    expect(
      formatCloudWorkspaceSettingsError({
        credentialError: error,
        fileError: null,
        setupError: null,
        lastApplyError: null,
      }),
    ).toBe("Credential sync failed: Start the workspace before re-syncing credentials.");
  });

  it("falls back to the raw message for other cloud error codes", () => {
    const error = new Error("boom") as Error & { code: string };
    error.code = "internal";

    expect(
      formatCloudWorkspaceSettingsError({
        credentialError: error,
        fileError: null,
        setupError: null,
        lastApplyError: null,
      }),
    ).toBe("Credential sync failed: boom");
  });

  it("prefixes file errors", () => {
    expect(
      formatCloudWorkspaceSettingsError({
        credentialError: null,
        fileError: new Error("disk full"),
        setupError: null,
        lastApplyError: null,
      }),
    ).toBe("File re-sync failed: disk full");
  });

  it("prefixes setup errors", () => {
    expect(
      formatCloudWorkspaceSettingsError({
        credentialError: null,
        fileError: null,
        setupError: new Error("script missing"),
        lastApplyError: null,
      }),
    ).toBe("Setup start failed: script missing");
  });

  it("prefers credential errors over file, setup, and lastApplyError", () => {
    expect(
      formatCloudWorkspaceSettingsError({
        credentialError: new Error("cred"),
        fileError: new Error("file"),
        setupError: new Error("setup"),
        lastApplyError: "old apply",
      }),
    ).toBe("Credential sync failed: cred");
  });

  it("prefers file errors over setup and lastApplyError", () => {
    expect(
      formatCloudWorkspaceSettingsError({
        credentialError: null,
        fileError: new Error("file"),
        setupError: new Error("setup"),
        lastApplyError: "old apply",
      }),
    ).toBe("File re-sync failed: file");
  });

  it("prefers setup errors over lastApplyError", () => {
    expect(
      formatCloudWorkspaceSettingsError({
        credentialError: null,
        fileError: null,
        setupError: new Error("setup"),
        lastApplyError: "old apply",
      }),
    ).toBe("Setup start failed: setup");
  });

  it("returns lastApplyError when no mutation errors are present", () => {
    expect(
      formatCloudWorkspaceSettingsError({
        credentialError: null,
        fileError: null,
        setupError: null,
        lastApplyError: "stale apply error",
      }),
    ).toBe("stale apply error");
  });
});
