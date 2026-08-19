// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionFileLink } from "#product/components/workspace/chat/tool-calls/CollapsedActionRowPrimitives";

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

describe("ActionFileLink", () => {
  it("preserves an explicit blank structured path without replacing the raw path", () => {
    render(
      <ActionFileLink
        rawPath="src/raw.ts"
        workspacePath=""
        displayName="raw.ts"
      />,
    );
    expect(badgeInputs).toContainEqual(expect.objectContaining({
      rawPath: "src/raw.ts",
      workspacePath: "",
      label: "raw.ts",
    }));
  });
});
