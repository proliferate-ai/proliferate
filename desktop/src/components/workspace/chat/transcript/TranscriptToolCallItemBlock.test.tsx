import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { toolCallItem } from "@/lib/domain/chat/__fixtures__/playground/tool-call-item-fixture";
import { TranscriptToolCallItemBlock } from "./TranscriptToolCallItemBlock";

vi.mock("@/hooks/cowork/workflows/use-open-cowork-coding-session", () => ({
  useOpenCoworkCodingSession: () => vi.fn(),
}));

vi.mock("@/hooks/workspaces/selection/use-workspace-selection", () => ({
  useWorkspaceSelection: () => ({
    selectWorkspace: vi.fn(),
  }),
}));

vi.mock("@/hooks/workspaces/files/use-file-reference-actions", () => ({
  useFileReferenceActions: ({ rawPath }: { rawPath: string }) => ({
    reference: {
      rawPath,
      path: rawPath,
      line: null,
      column: null,
      absolutePath: `/repo/${rawPath}`,
      workspacePath: rawPath,
    },
    openTargets: [],
    canOpenInSidebar: true,
    canOpenExternal: true,
    copyPath: vi.fn(),
    openInSidebar: vi.fn(),
    openDefault: vi.fn(),
    openPrimary: vi.fn(),
    openWithTarget: vi.fn(),
    reveal: vi.fn(),
  }),
}));

describe("TranscriptToolCallItemBlock", () => {
  it("collapses long file-change groups in chat", () => {
    const item = toolCallItem({
      semanticKind: "file_change",
      contentParts: Array.from({ length: 5 }, (_, index) => ({
        type: "file_change",
        operation: "edit",
        path: `/Users/pablo/proliferate/src/file-${index}.ts`,
        workspacePath: `src/file-${index}.ts`,
        basename: `file-${index}.ts`,
        additions: 1,
        deletions: 1,
        patch: "@@ -1 +1 @@\n-old\n+new",
      })),
    });

    const html = renderToStaticMarkup(
      createElement(TranscriptToolCallItemBlock, {
        item,
        workspaceId: "workspace-1",
        onOpenArtifact: () => {},
      }),
    );

    expect(html).toContain("src/file-0.ts");
    expect(html).toContain("src/file-2.ts");
    expect(html).not.toContain("src/file-3.ts");
    expect(html).toContain("Show 2 more");
  });
});
