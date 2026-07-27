// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ProviderConfigCreatorModal } from "#product/components/settings/panes/agent-auth/ProviderConfigCreatorModal";

// Radix Dialog (ModalShell) touches DOM APIs jsdom doesn't implement.
beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderModal(overrides: Partial<Parameters<typeof ProviderConfigCreatorModal>[0]> = {}) {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  render(
    <ProviderConfigCreatorModal
      open
      onClose={onClose}
      kind="aws_bedrock"
      submitLabel="Save"
      submitting={false}
      onSubmit={onSubmit}
      {...overrides}
    />,
  );
  return { onSubmit, onClose };
}

describe("ProviderConfigCreatorModal", () => {
  it("renders every field the aws_bedrock spec declares, region as text and bearer token masked", () => {
    renderModal();

    expect(screen.getByLabelText("Title")).toBeTruthy();
    const region = screen.getByLabelText("AWS region") as HTMLInputElement;
    const bearerToken = screen.getByLabelText("Bedrock bearer token") as HTMLInputElement;
    expect(region.type).toBe("text");
    expect(bearerToken.type).toBe("password");
  });

  it("renders the azure_openai spec's three fields with the api key masked", () => {
    renderModal({ kind: "azure_openai" });

    const endpoint = screen.getByLabelText("Resource endpoint") as HTMLInputElement;
    const deployment = screen.getByLabelText("Deployment name") as HTMLInputElement;
    const apiKey = screen.getByLabelText("API key") as HTMLInputElement;
    expect(endpoint.type).toBe("text");
    expect(deployment.type).toBe("text");
    expect(apiKey.type).toBe("password");
  });

  it("blocks submit until every required field (incl. title) is filled", () => {
    const { onSubmit } = renderModal();

    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Work Bedrock" } });
    fireEvent.change(screen.getByLabelText("AWS region"), { target: { value: "us-east-1" } });
    // Bearer token still empty -> still blocked.
    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);

    fireEvent.change(screen.getByLabelText("Bedrock bearer token"), {
      target: { value: "bedrock-token-abc" },
    });
    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", false);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledWith({
      title: "Work Bedrock",
      kind: "aws_bedrock",
      value: { region: "us-east-1", bearerToken: "bedrock-token-abc" },
    });
  });

  it("produces a keyed value map shaped by the kind's field spec, not a single string", () => {
    const { onSubmit } = renderModal({ kind: "azure_openai" });

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Work Azure" } });
    fireEvent.change(screen.getByLabelText("Resource endpoint"), {
      target: { value: "https://my-resource.openai.azure.com" },
    });
    fireEvent.change(screen.getByLabelText("Deployment name"), { target: { value: "gpt-4o" } });
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "azure-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSubmit).toHaveBeenCalledWith({
      title: "Work Azure",
      kind: "azure_openai",
      value: {
        endpoint: "https://my-resource.openai.azure.com",
        deployment: "gpt-4o",
        apiKey: "azure-secret",
      },
    });
  });

  it("resets the form when reopened, so a prior draft never leaks into the next open", () => {
    const { rerender } = (() => {
      const onSubmit = vi.fn();
      const onClose = vi.fn();
      const view = render(
        <ProviderConfigCreatorModal
          open
          onClose={onClose}
          kind="aws_bedrock"
          submitLabel="Save"
          submitting={false}
          onSubmit={onSubmit}
        />,
      );
      return view;
    })();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Draft" } });
    fireEvent.change(screen.getByLabelText("AWS region"), { target: { value: "eu-west-1" } });

    rerender(
      <ProviderConfigCreatorModal
        open={false}
        onClose={() => {}}
        kind="aws_bedrock"
        submitLabel="Save"
        submitting={false}
        onSubmit={vi.fn()}
      />,
    );
    rerender(
      <ProviderConfigCreatorModal
        open
        onClose={() => {}}
        kind="aws_bedrock"
        submitLabel="Save"
        submitting={false}
        onSubmit={vi.fn()}
      />,
    );

    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("AWS region") as HTMLInputElement).value).toBe("");
  });

  it("shows the submit error message when provided", () => {
    renderModal({ error: "Could not save this configuration." });
    expect(screen.getByText("Could not save this configuration.")).toBeTruthy();
  });
});
