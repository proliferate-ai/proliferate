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

vi.mock("#product/config/harness-env-vars", () => ({
  PROVIDER_REGISTRY: [
    { id: "anthropic", displayName: "Anthropic", envVarNames: ["ANTHROPIC_API_KEY"] },
    { id: "openai", displayName: "OpenAI", envVarNames: ["OPENAI_API_KEY"] },
    { id: "openrouter", displayName: "OpenRouter", envVarNames: ["OPENROUTER_API_KEY"] },
    { id: "obscure", displayName: "Obscure Cloud", envVarNames: ["OBSCURE_API_KEY"] },
    { id: "noenv", displayName: "NoEnv Provider", envVarNames: [] },
  ],
}));

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

  it("does not submit an empty paste field", () => {
    const onSubmit = vi.fn();
    render(<ProviderPickerModal open onClose={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByText("OpenRouter"));
    fireEvent.click(screen.getByText("Save"));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
