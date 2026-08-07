/* @vitest-environment jsdom */

import type { ReadWorkspaceFileResponse } from "@anyharness/sdk";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FileViewerContent } from "#product/components/workspace/files/FileViewerContent";

afterEach(() => {
  cleanup();
});

const MARKDOWN_READ: ReadWorkspaceFileResponse = {
  content: "# Title\n\nBody paragraph.",
  isText: true,
  kind: "file",
  path: "README.md",
  sizeBytes: 24,
  tooLarge: false,
};

describe("FileViewerContent rendered preview", () => {
  it("virtualizes the rendered Markdown body so large documents stay cheap to re-lay out", () => {
    const { container } = render(
      <FileViewerContent
        filePath="README.md"
        workspaceId="workspace-1"
        effectiveMode="rendered"
        read={MARKDOWN_READ}
        activeDiffTarget={null}
        diffLayout="unified"
        canShowRichPreview
        wordWrap={false}
      />,
    );

    const body = container.querySelector("[data-markdown-body]");
    expect(body?.className).toContain("file-preview-virtualized");
  });
});
