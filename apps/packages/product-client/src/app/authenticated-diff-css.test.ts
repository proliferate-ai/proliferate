import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const AUTHENTICATED_CSS = readFileSync(
  new URL("./authenticated.css", import.meta.url),
  "utf8",
);
const EAGER_PRODUCT_CSS = readFileSync(
  new URL("../../../design/src/css/product.css", import.meta.url),
  "utf8",
);

describe("authenticated diff/virtualization CSS ownership", () => {
  it("keeps chat-diff and review virtualization styles behind the authenticated boundary", () => {
    // Thread/diff virtualization and the composer/sidebar/git-review diff
    // line treatment only ever render inside authenticated chat, file-viewer,
    // and git-review surfaces (PlaygroundSidebarGitDiff, TurnDiffPanel,
    // GitPanelReviewBody, FileViewerContent) — none of it is reachable
    // pre-auth, so it must not cost the login runtime CSS budget
    // (scripts/measure-login-runtime-budget.mjs).
    expect(AUTHENTICATED_CSS).toContain(".thread-diff-virtualized {");
    expect(AUTHENTICATED_CSS).toContain("[data-diff-row-virtualization]");
    expect(AUTHENTICATED_CSS).toContain(".file-preview-virtualized > *");
    expect(AUTHENTICATED_CSS).toContain(".composer-diff-simple-line {");
    expect(AUTHENTICATED_CSS).toContain("[data-git-review-document]");

    expect(EAGER_PRODUCT_CSS).not.toContain(".thread-diff-virtualized");
    expect(EAGER_PRODUCT_CSS).not.toContain("data-diff-row-virtualization");
    expect(EAGER_PRODUCT_CSS).not.toContain("file-preview-virtualized");
    expect(EAGER_PRODUCT_CSS).not.toContain("composer-diff-simple-line");
    expect(EAGER_PRODUCT_CSS).not.toContain("data-git-review-document");
  });
});
