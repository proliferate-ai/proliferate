import { describe, expect, it } from "vitest";
import { parseGitHubLink } from "./github-link";

describe("parseGitHubLink", () => {
  it("recognizes common GitHub link shapes without network metadata", () => {
    expect(parseGitHubLink("https://github.com/proliferate-ai/proliferate")).toMatchObject({
      kind: "repo",
      label: "proliferate-ai/proliferate",
      typeLabel: "Repo",
    });
    expect(parseGitHubLink("https://github.com/proliferate-ai/proliferate/issues/42"))
      .toMatchObject({
        kind: "issue",
        label: "proliferate-ai/proliferate#42",
        typeLabel: "Issue",
      });
    expect(parseGitHubLink("https://github.com/proliferate-ai/proliferate/pull/43"))
      .toMatchObject({
        kind: "pull",
        label: "proliferate-ai/proliferate#43",
        typeLabel: "PR",
      });
    expect(parseGitHubLink("https://github.com/proliferate-ai/proliferate/commit/0123456789abcdef"))
      .toMatchObject({
        kind: "commit",
        label: "proliferate-ai/proliferate@0123456",
        typeLabel: "Commit",
      });
    expect(parseGitHubLink("https://github.com/proliferate-ai/proliferate/blob/main/desktop/src/App.tsx"))
      .toMatchObject({
        kind: "file",
        label: "proliferate-ai/proliferate/desktop/src/App.tsx",
        typeLabel: "File",
      });
  });

  it("ignores unknown or unsafe links", () => {
    expect(parseGitHubLink("https://example.com/proliferate-ai/proliferate")).toBeNull();
    expect(parseGitHubLink("javascript:alert(1)")).toBeNull();
    expect(parseGitHubLink("https://github.com/proliferate-ai/proliferate/actions")).toBeNull();
  });
});
