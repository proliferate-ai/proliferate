import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ProviderLinkMention,
  isExternalHttpLink,
  linkHost,
} from "./ProviderLinkMention";

describe("isExternalHttpLink", () => {
  it("matches web URLs including scheme-less host/path forms", () => {
    for (const value of [
      "https://github.com/x/y",
      "http://example.com",
      "www.example.com",
      "www.example.com/docs",
      "github.com/org/repo/pull/1",
      "console.aws.amazon.com/ecs/home",
    ]) {
      expect(isExternalHttpLink(value)).toBe(true);
    }
  });

  it("rejects workspace paths, bare filenames, and non-http hrefs", () => {
    for (const value of [
      "src/App.tsx",
      "apps/desktop/src/components/Foo.tsx:12",
      "./relative/file.ts",
      "README.md",
      "#section",
      "mailto:a@b.com",
      "vscode://file/x",
    ]) {
      expect(isExternalHttpLink(value)).toBe(false);
    }
  });
});

describe("linkHost", () => {
  it("returns the hostname for web URLs and null otherwise", () => {
    expect(linkHost("https://console.aws.amazon.com/ecs")).toBe("console.aws.amazon.com");
    expect(linkHost("github.com/x/y")).toBe("github.com");
    expect(linkHost("README.md")).toBeNull();
    expect(linkHost("mailto:a@b.com")).toBeNull();
  });
});

describe("ProviderLinkMention", () => {
  it("uses the GitHub brand icon (no favicon) for github hosts", () => {
    const html = renderToStaticMarkup(
      <ProviderLinkMention href="https://github.com/proliferate-ai/proliferate/pull/737">
        PR #737
      </ProviderLinkMention>,
    );
    expect(html).toContain("data-provider-link-host=\"github.com\"");
    expect(html).toContain("PR #737");
    expect(html).not.toContain("favicons?domain");
  });

  it("uses the favicon service for other hosts", () => {
    const html = renderToStaticMarkup(
      <ProviderLinkMention href="https://console.aws.amazon.com/ecs/home">
        ECS
      </ProviderLinkMention>,
    );
    expect(html).toContain("data-provider-link-host=\"console.aws.amazon.com\"");
    expect(html).toContain(
      "https://www.google.com/s2/favicons?domain=console.aws.amazon.com",
    );
  });

  it("normalizes a scheme-less host to https for the real href", () => {
    const html = renderToStaticMarkup(
      <ProviderLinkMention href="github.com/x/y">x/y</ProviderLinkMention>,
    );
    expect(html).toContain("href=\"https://github.com/x/y\"");
    expect(html).toContain("data-provider-link-host=\"github.com\"");
  });

  it("falls back to a plain link for non-URL hrefs", () => {
    const html = renderToStaticMarkup(
      <ProviderLinkMention href="mailto:support@proliferate.com">email</ProviderLinkMention>,
    );
    expect(html).not.toContain("data-provider-link-host");
    expect(html).toContain("text-link-foreground underline");
  });
});
