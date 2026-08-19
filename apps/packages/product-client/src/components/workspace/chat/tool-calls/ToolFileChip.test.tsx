// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolFileChip } from "#product/components/workspace/chat/tool-calls/ToolFileChip";

const badgeInputs = vi.hoisted(() => ([] as Array<Record<string, unknown>>));

vi.mock("#product/components/workspace/file-references/FileReferenceBadge", () => ({
  FileReferenceBadge: (props: Record<string, unknown>) => {
    badgeInputs.push(props);
    return <span data-mocked-file-reference />;
  },
}));

afterEach(() => {
  cleanup();
  badgeInputs.length = 0;
});

describe("ToolFileChip", () => {
  it("forwards raw and structured paths through separate channels", () => {
    render(
      <ToolFileChip
        basename="visible.ts"
        rawPath="src/raw/visible.ts"
        workspacePath=""
      />,
    );

    expect(badgeInputs).toContainEqual(expect.objectContaining({
      rawPath: "src/raw/visible.ts",
      workspacePath: "",
      basename: "visible.ts",
      label: "visible.ts",
      variant: "chip",
    }));
  });
});
