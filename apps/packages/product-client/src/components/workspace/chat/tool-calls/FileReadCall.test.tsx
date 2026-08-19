// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileReadCall } from "#product/components/workspace/chat/tool-calls/FileReadCall";

const chipInputs = vi.hoisted(() => ([] as Array<Record<string, unknown>>));

vi.mock("#product/components/workspace/chat/tool-calls/ToolFileChip", () => ({
  ToolFileChip: (props: Record<string, unknown>) => {
    chipInputs.push(props);
    return <span data-mocked-file-chip />;
  },
}));

afterEach(() => {
  cleanup();
  chipInputs.length = 0;
});

describe("FileReadCall", () => {
  it("keeps the raw wire path when a structured blank path is supplied", () => {
    render(
      <FileReadCall
        path="src/raw/visible.ts"
        workspacePath=""
        basename="visible.ts"
      />,
    );
    expect(chipInputs).toContainEqual(expect.objectContaining({
      rawPath: "src/raw/visible.ts",
      workspacePath: "",
      basename: "visible.ts",
    }));
  });

  it("preserves null as absent structured metadata", () => {
    render(<FileReadCall path="src/raw.ts" workspacePath={null} />);
    expect(chipInputs).toContainEqual(expect.objectContaining({
      rawPath: "src/raw.ts",
      workspacePath: null,
    }));
  });
});
