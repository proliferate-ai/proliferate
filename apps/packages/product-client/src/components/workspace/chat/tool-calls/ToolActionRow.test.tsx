// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Brain } from "@proliferate/ui/icons";
import { ToolActionRow } from "#product/components/workspace/chat/tool-calls/ToolActionRow";

afterEach(cleanup);

describe("ToolActionRow", () => {
  it("tightens only the leading icon-to-label gap", () => {
    render(
      <ToolActionRow
        icon={<Brain />}
        label="Thought"
        hint="Inspecting the request"
        status="completed"
      />,
    );

    const row = screen.getByText("Thought").closest("[data-tool-action-row]");
    const labelAndHint = screen.getByText("Thought").parentElement;

    expect(row?.classList.contains("gap-1")).toBe(true);
    expect(row?.classList.contains("gap-1.5")).toBe(false);
    expect(labelAndHint?.classList.contains("gap-1.5")).toBe(true);
  });
});
