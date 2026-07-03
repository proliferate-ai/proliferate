// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderPickerModal } from "./ProviderPickerModal";

// ModalShell wraps Radix Dialog (no jsdom polyfills) — stub to a passthrough
// that renders its body when open.
vi.mock("@proliferate/ui/primitives/ModalShell", () => ({
  ModalShell: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
}));

vi.mock("@/config/harness-env-vars", () => ({
  PROVIDER_REGISTRY: [
    { id: "anthropic", displayName: "Anthropic", envVarNames: ["ANTHROPIC_API_KEY"] },
    { id: "openrouter", displayName: "OpenRouter", envVarNames: ["OPENROUTER_API_KEY"] },
    { id: "noenv", displayName: "NoEnv Provider", envVarNames: [] },
  ],
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProviderPickerModal", () => {
  it("lists providers with a known env var and omits those without one", () => {
    render(<ProviderPickerModal open onClose={vi.fn()} onSelect={vi.fn()} />);

    expect(screen.queryByText("Anthropic")).not.toBeNull();
    expect(screen.queryByText("OpenRouter")).not.toBeNull();
    expect(screen.queryByText("ANTHROPIC_API_KEY")).not.toBeNull();
    expect(screen.queryByText("NoEnv Provider")).toBeNull();
  });

  it("filters the list by search query", () => {
    render(<ProviderPickerModal open onClose={vi.fn()} onSelect={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Search providers"), {
      target: { value: "openr" },
    });

    expect(screen.queryByText("OpenRouter")).not.toBeNull();
    expect(screen.queryByText("Anthropic")).toBeNull();
  });

  it("selects a provider and closes", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<ProviderPickerModal open onClose={onClose} onSelect={onSelect} />);

    fireEvent.click(screen.getByText("OpenRouter"));

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "openrouter", envVarNames: ["OPENROUTER_API_KEY"] }),
    );
    expect(onClose).toHaveBeenCalled();
  });
});
