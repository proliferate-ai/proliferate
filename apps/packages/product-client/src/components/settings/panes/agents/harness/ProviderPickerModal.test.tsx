// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderPickerModal } from "#product/components/settings/panes/agents/harness/ProviderPickerModal";

// ModalShell wraps Radix Dialog (no jsdom polyfills) — stub to a passthrough
// that renders its body when open.
vi.mock("@proliferate/ui/patterns/ModalShell", () => ({
  ModalShell: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
}));

// The real getProviderSecretEnvVar is exercised here (it IS the fix for the
// invalid-env-var / key-shape findings); only the registry data is stubbed.
vi.mock("#product/config/harness-env-vars", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("#product/config/harness-env-vars")
  >();
  return {
    getProviderSecretEnvVar: actual.getProviderSecretEnvVar,
    PROVIDER_REGISTRY: [
      { id: "anthropic", displayName: "Anthropic", envVarNames: ["ANTHROPIC_API_KEY"] },
      { id: "openai", displayName: "OpenAI", envVarNames: ["OPENAI_API_KEY"] },
      { id: "openrouter", displayName: "OpenRouter", envVarNames: ["OPENROUTER_API_KEY"] },
      { id: "obscure", displayName: "Obscure Cloud", envVarNames: ["OBSCURE_API_KEY"] },
      { id: "noenv", displayName: "NoEnv Provider", envVarNames: [] },
      // Digit-leading name: never passes the server's ENV_VAR_NAME_RE.
      { id: "302ai", displayName: "302.AI", envVarNames: ["302AI_API_KEY"] },
      // Multi-field: envVarNames[0] is a resource name, not the secret.
      { id: "azure", displayName: "Azure", envVarNames: ["AZURE_RESOURCE_NAME", "AZURE_API_KEY"] },
      {
        id: "amazon-bedrock",
        displayName: "Amazon Bedrock",
        envVarNames: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION"],
      },
      // No key-shaped var at all: belongs to the typed provider-config path.
      {
        id: "google-vertex",
        displayName: "Google Vertex",
        envVarNames: ["GOOGLE_VERTEX_PROJECT", "GOOGLE_VERTEX_LOCATION"],
      },
    ],
  };
});

vi.mock("#product/config/provider-logos.generated", () => ({
  PROVIDER_LOGO_URLS: { anthropic: "/logos/anthropic.svg" },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProviderPickerModal", () => {
  it("lists featured providers with a known env var and omits those without one", () => {
    render(<ProviderPickerModal open onClose={vi.fn()} onSubmit={vi.fn()} />);

    expect(screen.queryByText("Anthropic")).not.toBeNull();
    expect(screen.queryByText("OpenAI")).not.toBeNull();
    expect(screen.queryByText("ANTHROPIC_API_KEY")).not.toBeNull();
    expect(screen.queryByText("NoEnv Provider")).toBeNull();
  });

  it("collapses non-featured providers behind the show-more toggle", () => {
    render(<ProviderPickerModal open onClose={vi.fn()} onSubmit={vi.fn()} />);

    expect(screen.queryByText("Obscure Cloud")).toBeNull();

    fireEvent.click(screen.getByText(/Show more providers/));
    expect(screen.queryByText("Obscure Cloud")).not.toBeNull();

    fireEvent.click(screen.getByText("Show fewer providers"));
    expect(screen.queryByText("Obscure Cloud")).toBeNull();
  });

  it("expands already-configured providers by default", () => {
    render(
      <ProviderPickerModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        configuredProviderIds={["obscure"]}
      />,
    );

    expect(screen.queryByText("Obscure Cloud")).not.toBeNull();
  });

  it("searches the full list, not just the featured tier", () => {
    render(<ProviderPickerModal open onClose={vi.fn()} onSubmit={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Search providers"), {
      target: { value: "obscure" },
    });

    expect(screen.queryByText("Obscure Cloud")).not.toBeNull();
    expect(screen.queryByText("Anthropic")).toBeNull();
    // Search replaces the collapse affordance entirely.
    expect(screen.queryByText(/Show more providers/)).toBeNull();
  });

  it("filters the list by search query", () => {
    render(<ProviderPickerModal open onClose={vi.fn()} onSubmit={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Search providers"), {
      target: { value: "openr" },
    });

    expect(screen.queryByText("OpenRouter")).not.toBeNull();
    expect(screen.queryByText("Anthropic")).toBeNull();
  });

  it("renders a vendored logo when mapped and a neutral fallback otherwise", () => {
    const { container } = render(
      <ProviderPickerModal open onClose={vi.fn()} onSubmit={vi.fn()} />,
    );

    const images = container.querySelectorAll("img");
    expect(images.length).toBe(1);
    expect(images[0]?.getAttribute("src")).toBe("/logos/anthropic.svg");
  });

  it("expands the selected row into an inline paste field and submits the value", () => {
    const onSubmit = vi.fn();
    render(<ProviderPickerModal open onClose={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByText("OpenRouter"));

    const field = screen.getByLabelText("OpenRouter API key");
    fireEvent.change(field, { target: { value: " sk-test " } });
    fireEvent.click(screen.getByText("Save"));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "openrouter", envVarNames: ["OPENROUTER_API_KEY"] }),
      "sk-test",
    );
  });

  it("omits a provider whose only env var can never pass server validation", () => {
    // "302AI_API_KEY" starts with a digit: ENV_VAR_NAME_RE rejects it, so every
    // save would create a vault key and then 400 (orphan).
    render(<ProviderPickerModal open onClose={vi.fn()} onSubmit={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Search providers"), {
      target: { value: "302" },
    });

    expect(screen.queryByText("302.AI")).toBeNull();
  });

  it("omits a provider with no key-shaped env var (typed-config path)", () => {
    render(<ProviderPickerModal open onClose={vi.fn()} onSubmit={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Search providers"), {
      target: { value: "vertex" },
    });

    expect(screen.queryByText("Google Vertex")).toBeNull();
  });

  it("labels multi-field providers with their key-shaped env var, not the first", () => {
    render(<ProviderPickerModal open onClose={vi.fn()} onSubmit={vi.fn()} />);

    expect(screen.queryByText("AZURE_API_KEY")).not.toBeNull();
    expect(screen.queryByText("AZURE_RESOURCE_NAME")).toBeNull();
    expect(screen.queryByText("AWS_SECRET_ACCESS_KEY")).not.toBeNull();
    expect(screen.queryByText("AWS_ACCESS_KEY_ID")).toBeNull();
  });

  it("renders an already-bound provider as configured with no add path", () => {
    const onSubmit = vi.fn();
    render(
      <ProviderPickerModal
        open
        onClose={vi.fn()}
        onSubmit={onSubmit}
        boundEnvVarNames={["OPENROUTER_API_KEY"]}
      />,
    );

    expect(screen.queryByText("Configured")).not.toBeNull();
    // No expandable row, so no way to start a duplicate add.
    fireEvent.click(screen.getByText("OpenRouter"));
    expect(screen.queryByLabelText("OpenRouter API key")).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps an already-bound non-featured provider visible as configured", () => {
    render(
      <ProviderPickerModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        boundEnvVarNames={["OBSCURE_API_KEY"]}
      />,
    );

    expect(screen.queryByText("Obscure Cloud")).not.toBeNull();
    expect(screen.queryByText("Configured")).not.toBeNull();
  });

  it("preserves the typed secret when the open row is re-clicked", () => {
    const onSubmit = vi.fn();
    render(<ProviderPickerModal open onClose={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByText("OpenRouter"));
    fireEvent.change(screen.getByLabelText("OpenRouter API key"), {
      target: { value: "sk-draft" },
    });
    // Collapse, then re-open: the draft survives.
    fireEvent.click(screen.getByText("OpenRouter"));
    expect(screen.queryByLabelText("OpenRouter API key")).toBeNull();

    fireEvent.click(screen.getByText("OpenRouter"));
    expect(
      (screen.getByLabelText("OpenRouter API key") as HTMLInputElement).value,
    ).toBe("sk-draft");
  });

  it("renders a submit failure inline on the selected row", () => {
    render(
      <ProviderPickerModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        error="Duplicate selection source"
      />,
    );

    // The error belongs to the expanded row only.
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByText("OpenRouter"));
    expect(screen.getByRole("alert").textContent).toBe("Duplicate selection source");
  });

  it("does not submit an empty paste field", () => {
    const onSubmit = vi.fn();
    render(<ProviderPickerModal open onClose={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByText("OpenRouter"));
    fireEvent.click(screen.getByText("Save"));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
