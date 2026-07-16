import { AnyHarnessError } from "@anyharness/sdk";
import { ProliferateClientError } from "@proliferate/cloud-sdk";
import { describe, expect, it } from "vitest";
import {
  classifyTelemetryFailure,
  isExpectedQueryTelemetryError,
} from "#product/lib/domain/telemetry/failures";

describe("query telemetry failure classification", () => {
  it("classifies AbortError by type and treats it as an expected query state", () => {
    const error = new DOMException("Aborted", "AbortError");

    expect(classifyTelemetryFailure(error)).toBe("aborted");
    expect(isExpectedQueryTelemetryError(error)).toBe(true);
  });

  it.each([401, 403])(
    "treats status %i as an expected auth or permission gate",
    (status) => {
      const error = new ProliferateClientError("Authentication required", status);

      expect(classifyTelemetryFailure(error)).toBe("permission_error");
      expect(isExpectedQueryTelemetryError(error)).toBe(true);
    },
  );

  it.each([400, 404, 409, 422])(
    "keeps generic status %i reportable",
    (status) => {
      const error = new ProliferateClientError("Configuration unavailable", status);

      expect(classifyTelemetryFailure(error)).toBe("configuration_error");
      expect(isExpectedQueryTelemetryError(error)).toBe(false);
    },
  );

  it("keeps a generic Not Found response reportable", () => {
    const error = new ProliferateClientError("Not Found", 404);

    expect(isExpectedQueryTelemetryError(error)).toBe(false);
  });

  it.each([
    "github_app_authorization_required",
    "github_app_authorization_expired",
    "github_app_installation_required",
    "github_app_repo_not_covered",
    "github_repo_access_required",
  ])("treats explicit GitHub App code %s as expected state", (code) => {
    const error = new ProliferateClientError("GitHub App action required", 409, code);

    expect(isExpectedQueryTelemetryError(error)).toBe(true);
  });

  it.each([
    "HOSTING_GH_NOT_INSTALLED",
    "HOSTING_GH_AUTH_REQUIRED",
    "HOSTING_REMOTE_UNSUPPORTED",
  ])("treats AnyHarness %s as typed expected availability", (code) => {
    const error = new AnyHarnessError({
      type: "about:blank",
      title: "Hosting unavailable",
      status: 400,
      code,
    });

    expect(classifyTelemetryFailure(error)).toBe("configuration_error");
    expect(isExpectedQueryTelemetryError(error)).toBe(true);
  });

  it("does not let an availability code hide a 5xx request failure", () => {
    const error = new AnyHarnessError({
      type: "about:blank",
      title: "Request failed",
      status: 503,
      code: "HOSTING_GH_NOT_INSTALLED",
    });

    expect(classifyTelemetryFailure(error)).toBe("request_error");
    expect(isExpectedQueryTelemetryError(error)).toBe(false);
  });

  it("does not let a GitHub App state code hide a 5xx request failure", () => {
    const error = new ProliferateClientError(
      "GitHub App request failed",
      503,
      "github_app_installation_required",
    );

    expect(isExpectedQueryTelemetryError(error)).toBe(false);
  });

  it("uses a typed availability code when no status is present", () => {
    const error = Object.assign(new Error("Hosting unavailable"), {
      problem: { code: "HOSTING_GH_NOT_INSTALLED" },
    });

    expect(isExpectedQueryTelemetryError(error)).toBe(true);
  });

  it("uses an explicit GitHub App state code when no status is present", () => {
    const error = Object.assign(new Error("Reconnect GitHub App"), {
      code: "github_app_authorization_expired",
    });

    expect(isExpectedQueryTelemetryError(error)).toBe(true);
  });

  it.each([
    "HOSTING_PR_VIEW_FAILED",
    "HOSTING_PR_CREATE_FAILED",
  ])("keeps AnyHarness %s request errors reportable", (code) => {
    const error = new AnyHarnessError({
      type: "about:blank",
      title: "Hosting request failed",
      status: 400,
      code,
    });

    expect(isExpectedQueryTelemetryError(error)).toBe(false);
  });

  it.each([
    [new ProliferateClientError("Request failed", 503), "request_error"],
    [new TypeError("Failed to fetch"), "network_error"],
    [new Error("Invariant failed"), "unknown_error"],
  ] as const)("keeps capture-worthy %s failures reportable", (error, kind) => {
    expect(classifyTelemetryFailure(error)).toBe(kind);
    expect(isExpectedQueryTelemetryError(error)).toBe(false);
  });

  it("does not suppress an unknown coded error from configuration-like wording", () => {
    const error = Object.assign(new Error("Missing configuration invariant"), {
      code: "INTERNAL_STATE_INVALID",
    });

    expect(isExpectedQueryTelemetryError(error)).toBe(false);
  });

  it("does not suppress an unrecognized 409 product code", () => {
    const error = new ProliferateClientError(
      "Workspace state conflict",
      409,
      "workspace_state_conflict",
    );

    expect(isExpectedQueryTelemetryError(error)).toBe(false);
  });

  it("does not use configuration-like wording when a non-HTTP status exists", () => {
    const error = Object.assign(new Error("Missing configuration invariant"), {
      status: 0,
    });

    expect(isExpectedQueryTelemetryError(error)).toBe(false);
  });
});
