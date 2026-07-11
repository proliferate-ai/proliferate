// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateSchemaProfile } from "@proliferate/product-domain/workflows/contracts/schema-profile";
import { WorkflowEmitSchemaBuilder } from "./WorkflowEmitSchemaBuilder";

afterEach(cleanup);

describe("WorkflowEmitSchemaBuilder (WS9b item 1)", () => {
  it("authors a v1-profile-valid schema from a structured field", () => {
    const onChange = vi.fn<(schema: Record<string, unknown> | undefined) => void>();
    render(<WorkflowEmitSchemaBuilder schema={undefined} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Add field" }));
    fireEvent.change(screen.getByLabelText("Property name"), { target: { value: "done" } });

    const calls = onChange.mock.calls;
    const last = calls[calls.length - 1]![0]!;
    expect(() => validateSchemaProfile(last)).not.toThrow();
    expect(last).toEqual({
      type: "object",
      additionalProperties: false,
      properties: { done: { type: "string" } },
      required: ["done"],
    });
  });

  it("the JSON escape hatch rejects invalid JSON and accepts a profile-valid rich schema", () => {
    const onChange = vi.fn<(schema: Record<string, unknown> | undefined) => void>();
    render(<WorkflowEmitSchemaBuilder schema={undefined} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "JSON" }));
    const textarea = screen.getByLabelText("Output schema JSON");

    fireEvent.change(textarea, { target: { value: "{ not json" } });
    expect(screen.getByText("Not valid JSON.")).toBeTruthy();

    const rich = JSON.stringify({
      type: "object",
      properties: {
        category: { type: "string", enum: ["low", "high"] },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["category"],
    });
    fireEvent.change(textarea, { target: { value: rich } });
    expect(onChange).toHaveBeenLastCalledWith(JSON.parse(rich));
  });

  it("rejects a JSON schema outside the v1 profile with an inline error", () => {
    const onChange = vi.fn<(schema: Record<string, unknown> | undefined) => void>();
    render(<WorkflowEmitSchemaBuilder schema={undefined} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "JSON" }));
    // `pattern` is not a permitted v1 keyword.
    fireEvent.change(screen.getByLabelText("Output schema JSON"), {
      target: { value: JSON.stringify({ type: "object", properties: { x: { type: "string", pattern: "^a" } } }) },
    });
    expect(screen.getByText(/not a valid v1 schema/i)).toBeTruthy();
  });

  it("opens on the JSON tab for a schema outside the structured subset", () => {
    render(
      <WorkflowEmitSchemaBuilder
        schema={{ type: "object", properties: { c: { type: "string", enum: ["a"] } } }}
        onChange={vi.fn()}
      />,
    );
    // The JSON textarea is present (fields tab would not render it).
    expect(screen.getByLabelText("Output schema JSON")).toBeTruthy();
  });
});
