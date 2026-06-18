import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ProviderLinkMention,
  isExternalHttpLink,
  linkHost,
  rootDomain,
} from "./ProviderLinkMention";

describe("rootDomain", () => {
  it("collapses subdomains to the last two labels", () => {
    expect(rootDomain("console.aws.amazon.com")).toBe("amazon.com");
    expect(rootDomain("github.com")).toBe("github.com");
    expect(rootDomain("linear.app")).toBe("linear.app");
  });
});

describe("isExternalHttpLink", () => {
  it("matches http(s) and www. web URLs", () => {
    for (const value of [
      "https://github.com/x/y",
      "http://example.com",
      "www.example.com",
      "www.example.com/docs",
    ]) {
      expect(isExternalHttpLink(value)).toBe(true);
    }
  });

  it("rejects file paths, dotted-dir paths, scheme-less hosts, and non-http hrefs", () => {
    for (const value of [
      "src/App.tsx",
      "apps/desktop/src/components/Foo.tsx:12",
      "./relative/file.ts",
      "README.md",
      // dotted directory segments must NOT be mistaken for a host.tld
      "v1.2/notes.txt",
      "CHANGELOG.md/x",
      // scheme-less hosts are left to file detection (rare in practice)
      "github.com/org/repo/pull/1",
      "console.aws.amazon.com/ecs/home",
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
    expect(linkHost("www.example.com/docs")).toBe("www.example.com");
    expect(linkHost("github.com/x/y")).toBeNull();
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
    expect(html).not.toContain("favicon.ico");
  });

  it("uses the host's own favicon for non-github hosts (no third party)", () => {
    const html = renderToStaticMarkup(
      <ProviderLinkMention href="https://console.aws.amazon.com/ecs/home">
        ECS
      </ProviderLinkMention>,
    );
    expect(html).toContain("data-provider-link-host=\"console.aws.amazon.com\"");
    expect(html).toContain("src=\"https://console.aws.amazon.com/favicon.ico\"");
    expect(html).not.toContain("google.com/s2/favicons");
  });

  it("normalizes a scheme-less www host to https for the real href", () => {
    const html = renderToStaticMarkup(
      <ProviderLinkMention href="www.example.com/docs">docs</ProviderLinkMention>,
    );
    expect(html).toContain("href=\"https://www.example.com/docs\"");
    expect(html).toContain("data-provider-link-host=\"www.example.com\"");
  });

  it("falls back to a plain link for non-URL hrefs", () => {
    const html = renderToStaticMarkup(
      <ProviderLinkMention href="mailto:support@proliferate.com">email</ProviderLinkMention>,
    );
    expect(html).not.toContain("data-provider-link-host");
    expect(html).toContain("text-link-foreground underline");
  });
});
