// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkflowRequiredInvocation } from "@proliferate/product-domain/workflows/definition";
import { WorkflowRequiredInvocationField } from "./WorkflowRequiredInvocationField";

afterEach(cleanup);

const FUNCTIONS = [
  { name: "capture_event", displayName: "Capture event" },
  { name: "record_lookup", displayName: null },
];

describe("WorkflowRequiredInvocationField (WS9b item 2)", () => {
  it("enabling with the functions grant stores the exact function wire shape", () => {
    const onChange = vi.fn<(next: WorkflowRequiredInvocation | undefined) => void>();
    render(
      <WorkflowRequiredInvocationField
        value={undefined}
        integrations={["functions"]}
        functionInvocations={FUNCTIONS}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("switch", { name: "Require a tool call" }));
    expect(onChange).toHaveBeenCalledWith({ provider: "functions", tool: "capture_event" });
  });

  it("enabling with only a provider grant stores {provider, tool:''} and the tool input edits it", () => {
    const onChange = vi.fn<(next: WorkflowRequiredInvocation | undefined) => void>();
    const { rerender } = render(
      <WorkflowRequiredInvocationField
        value={undefined}
        integrations={["slack"]}
        functionInvocations={[]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("switch", { name: "Require a tool call" }));
    expect(onChange).toHaveBeenCalledWith({ provider: "slack", tool: "" });

    // Now render the enabled state and type the exact tool name.
    rerender(
      <WorkflowRequiredInvocationField
        value={{ provider: "slack", tool: "" }}
        integrations={["slack"]}
        functionInvocations={[]}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("exact_tool_name"), {
      target: { value: "chat_postMessage" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ provider: "slack", tool: "chat_postMessage" });
  });

  it("disabling clears the gate (undefined)", () => {
    const onChange = vi.fn<(next: WorkflowRequiredInvocation | undefined) => void>();
    render(
      <WorkflowRequiredInvocationField
        value={{ provider: "functions", tool: "capture_event" }}
        integrations={["functions"]}
        functionInvocations={FUNCTIONS}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("switch", { name: "Require a tool call" }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("with no integrations declared, an enabled gate explains it needs a capability", () => {
    render(
      <WorkflowRequiredInvocationField
        value={{ provider: "", tool: "" }}
        integrations={[]}
        functionInvocations={[]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/names\s+one of those capabilities/i)).toBeTruthy();
  });
});
