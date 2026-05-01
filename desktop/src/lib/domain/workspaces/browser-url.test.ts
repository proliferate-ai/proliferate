import { describe, expect, it } from "vitest";
import {
  browserIframeSandbox,
  normalizeBrowserUrl,
} from "./browser-url";

describe("browser URL normalization", () => {
  it("normalizes common local preview inputs", () => {
    expect(normalizeBrowserUrl("3000")).toBe("http://localhost:3000/");
    expect(normalizeBrowserUrl("localhost:8080/path?x=1#top"))
      .toBe("http://localhost:8080/path?x=1#top");
    expect(normalizeBrowserUrl("0.0.0.0:5173/app?mode=dev#view"))
      .toBe("http://localhost:5173/app?mode=dev#view");
    expect(normalizeBrowserUrl("[::1]:3000")).toBe("http://[::1]:3000/");
  });

  it("defaults external bare hosts to https", () => {
    expect(normalizeBrowserUrl("example.com/docs")).toBe("https://example.com/docs");
  });

  it("rejects unsafe or malformed URLs", () => {
    expect(normalizeBrowserUrl("ftp://example.com")).toBeNull();
    expect(normalizeBrowserUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeBrowserUrl("http://user:pass@example.com")).toBeNull();
    expect(normalizeBrowserUrl("http://user%3Apass@example.com")).toBeNull();
    expect(normalizeBrowserUrl("localhost:99999")).toBeNull();
    expect(normalizeBrowserUrl("http://example.com/\nsecret")).toBeNull();
    expect(normalizeBrowserUrl(`https://example.com/${"x".repeat(4097)}`)).toBeNull();
  });

  it("only grants same-origin sandboxing to local or private origins", () => {
    expect(browserIframeSandbox("http://localhost:3000/", "http://127.0.0.1:1420"))
      .toBe("allow-scripts allow-forms allow-same-origin");
    expect(browserIframeSandbox("https://example.com/", "http://127.0.0.1:1420"))
      .toBe("allow-scripts allow-forms");
    expect(browserIframeSandbox("http://127.0.0.1:1420/", "http://127.0.0.1:1420"))
      .toBe("allow-scripts allow-forms");
  });
});
