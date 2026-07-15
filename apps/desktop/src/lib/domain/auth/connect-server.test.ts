import { describe, expect, it } from "vitest";
import { isServerMetaShape, normalizeServerUrl } from "./connect-server";

describe("normalizeServerUrl", () => {
  it("rejects a blank address", () => {
    expect(normalizeServerUrl("")).toEqual({ ok: false, error: "Enter a server address." });
    expect(normalizeServerUrl("   ")).toEqual({ ok: false, error: "Enter a server address." });
  });

  it("defaults to https when no scheme is given", () => {
    const result = normalizeServerUrl("proliferate.corp.example");
    expect(result).toEqual({
      ok: true,
      url: "https://proliferate.corp.example",
      host: "proliferate.corp.example",
    });
  });

  it("strips a trailing slash", () => {
    const result = normalizeServerUrl("https://proliferate.corp.example/");
    expect(result).toEqual({
      ok: true,
      url: "https://proliferate.corp.example",
      host: "proliferate.corp.example",
    });
  });

  it("preserves a non-root path without its trailing slash", () => {
    const result = normalizeServerUrl("https://proliferate.corp.example/api/");
    expect(result).toEqual({
      ok: true,
      url: "https://proliferate.corp.example/api",
      host: "proliferate.corp.example",
    });
  });

  it("preserves an explicit port", () => {
    const result = normalizeServerUrl("http://localhost:8000");
    expect(result).toEqual({
      ok: true,
      url: "http://localhost:8000",
      host: "localhost:8000",
    });
  });

  it("trims surrounding whitespace", () => {
    const result = normalizeServerUrl("  https://proliferate.corp.example  ");
    expect(result.ok).toBe(true);
  });

  it("rejects a non-http(s) scheme", () => {
    expect(normalizeServerUrl("ftp://proliferate.corp.example")).toEqual({
      ok: false,
      error: "Server address must start with http:// or https://.",
    });
  });

  it("rejects an address that fails to parse as a URL", () => {
    expect(normalizeServerUrl("https://")).toEqual({
      ok: false,
      error: "Enter a valid server address.",
    });
  });

});

describe("isServerMetaShape", () => {
  const validMeta = {
    serverVersion: "0.3.0",
    desktopVersion: "0.3.2",
    runtimeVersion: "0.3.1",
    workerVersion: "0.3.1",
    minDesktopVersion: "0.2.0",
  };

  it("accepts a well-shaped meta response", () => {
    expect(isServerMetaShape(validMeta)).toBe(true);
  });

  it("rejects null and non-objects", () => {
    expect(isServerMetaShape(null)).toBe(false);
    expect(isServerMetaShape(undefined)).toBe(false);
    expect(isServerMetaShape("a string")).toBe(false);
    expect(isServerMetaShape(42)).toBe(false);
  });

  it("rejects a response missing a required field", () => {
    const { serverVersion: _serverVersion, ...withoutServerVersion } = validMeta;
    expect(isServerMetaShape(withoutServerVersion)).toBe(false);
  });

  it("rejects a response whose fields have the wrong type", () => {
    expect(isServerMetaShape({ ...validMeta, serverVersion: 3 })).toBe(false);
  });

  it("rejects an unrelated JSON body (e.g. a non-Proliferate server on that host)", () => {
    expect(isServerMetaShape({ status: "ok" })).toBe(false);
  });
});
