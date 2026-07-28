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

function renderModal(props: Partial<Parameters<typeof ProviderPickerModal>[0]> = {}) {
  return render(
    <ProviderPickerModal
      open
      onClose={vi.fn()}
      onSubmit={vi.fn()}
      onRemove={vi.fn()}
      {...props}
    />,
  );
}

/**
 * Render with a stable base-prop object plus a typed rerender, for tests that
 * drive the submitting/error props across renders (the success-collapse
 * effect keys on the submitting→idle transition).
 */
function renderModalControlled(
  props: Partial<Parameters<typeof ProviderPickerModal>[0]> = {},
) {
  const baseProps = {
    open: true,
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    onRemove: vi.fn(),
    ...props,
  };
  const view = render(<ProviderPickerModal {...baseProps} />);
  return {
    baseProps,
    rerender: (next: Parameters<typeof ProviderPickerModal>[0]) =>
      view.rerender(<ProviderPickerModal {...next} />),
  };
}

describe("ProviderPickerModal", () => {
  it("lists featured providers with a known env var and omits those without one", () => {
    renderModal();

    expect(screen.queryByText("Anthropic")).not.toBeNull();
    expect(screen.queryByText("OpenAI")).not.toBeNull();
    // Env-var names are internal wiring, never shown on collapsed rows.
    expect(screen.queryByText("ANTHROPIC_API_KEY")).toBeNull();
    expect(screen.queryByText("NoEnv Provider")).toBeNull();
  });

  it("collapses non-featured providers behind the view-all footer", () => {
    renderModal();

    expect(screen.queryByText("Obscure Cloud")).toBeNull();

    fireEvent.click(screen.getByText(/View all providers/));
    expect(screen.queryByText("Obscure Cloud")).not.toBeNull();

    fireEvent.click(screen.getByText("Show featured providers"));
    expect(screen.queryByText("Obscure Cloud")).toBeNull();
  });

  it("searches the full list, not just the featured tier", () => {
    renderModal();

    fireEvent.change(screen.getByLabelText("Search providers"), {
      target: { value: "obscure" },
    });

    expect(screen.queryByText("Obscure Cloud")).not.toBeNull();
    expect(screen.queryByText("Anthropic")).toBeNull();
    // Search replaces the footer affordance entirely.
    expect(screen.queryByText(/View all providers/)).toBeNull();
  });

  it("filters the list by search query", () => {
    renderModal();

    fireEvent.change(screen.getByLabelText("Search providers"), {
      target: { value: "openr" },
    });

    expect(screen.queryByText("OpenRouter")).not.toBeNull();
    expect(screen.queryByText("Anthropic")).toBeNull();
  });

  it("renders a vendored logo when mapped and a mono letter fallback otherwise", () => {
    const { container } = renderModal();

    const images = container.querySelectorAll("img");
    expect(images.length).toBe(1);
    expect(images[0]?.getAttribute("src")).toBe("/logos/anthropic.svg");
  });

  it("expands the selected row into an inline paste field and submits the value", () => {
    const onSubmit = vi.fn();
    renderModal({ onSubmit });

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
    renderModal();

    fireEvent.change(screen.getByLabelText("Search providers"), {
      target: { value: "302" },
    });

    expect(screen.queryByText("302.AI")).toBeNull();
  });

  it("omits a provider with no key-shaped env var (typed-config path)", () => {
    renderModal();

    fireEvent.change(screen.getByLabelText("Search providers"), {
      target: { value: "vertex" },
    });

    expect(screen.queryByText("Google Vertex")).toBeNull();
  });

  it("never surfaces env-var names on collapsed provider rows", () => {
    renderModal();

    expect(screen.queryByText("AZURE_API_KEY")).toBeNull();
    expect(screen.queryByText("AZURE_RESOURCE_NAME")).toBeNull();
    expect(screen.queryByText("AWS_SECRET_ACCESS_KEY")).toBeNull();
    expect(screen.queryByText("AWS_ACCESS_KEY_ID")).toBeNull();
  });

  it("marks an already-bound provider configured, expandable to Remove + Replace", () => {
    const onRemove = vi.fn();
    renderModal({
      boundEnvVarNames: ["OPENROUTER_API_KEY"],
      onRemove,
    });

    expect(screen.queryByText("configured")).not.toBeNull();

    // The configured row is a management surface: expanding shows the wired
    // hint, a Remove action, and a Replace input.
    fireEvent.click(screen.getByText("OpenRouter"));
    expect(screen.queryByText(/OPENROUTER_API_KEY/)).not.toBeNull();
    expect(
      (screen.getByLabelText("OpenRouter API key") as HTMLInputElement).placeholder,
    ).toContain("Replace");

    fireEvent.click(screen.getByText("Remove"));
    expect(onRemove).toHaveBeenCalledWith("openrouter", "OPENROUTER_API_KEY");
  });

  it("shows the vault key's redacted hint on the configured expanded row", () => {
    renderModal({
      boundEnvVarNames: ["OPENROUTER_API_KEY"],
      rowKeyIdsByEnvVar: new Map([["OPENROUTER_API_KEY", "key-1"]]),
      keysById: new Map([
        [
          "key-1",
          {
            id: "key-1",
            title: "OpenRouter API key",
            redactedHint: "sk-or-…3f2",
            status: "active",
          } as never,
        ],
      ]),
    });

    fireEvent.click(screen.getByText("OpenRouter"));
    expect(screen.queryByText(/sk-or-…3f2/)).not.toBeNull();
  });

  it("keeps an already-bound non-featured provider visible as configured", () => {
    renderModal({ boundEnvVarNames: ["OBSCURE_API_KEY"] });

    expect(screen.queryByText("Obscure Cloud")).not.toBeNull();
    expect(screen.queryByText("configured")).not.toBeNull();
  });

  it("replaces a configured provider's key via a single submit (no remove)", () => {
    // Replace is a single selection PUT downstream: addBoundApiKey swaps the
    // row on the same env var. A separate remove-then-submit pair would race
    // (two PUTs from one render's closure) and always collide server-side on
    // the duplicated env var.
    const onSubmit = vi.fn();
    const onRemove = vi.fn();
    renderModal({
      boundEnvVarNames: ["OPENROUTER_API_KEY"],
      onSubmit,
      onRemove,
    });

    fireEvent.click(screen.getByText("OpenRouter"));
    fireEvent.change(screen.getByLabelText("OpenRouter API key"), {
      target: { value: "sk-new" },
    });
    fireEvent.click(screen.getByText("Save"));

    expect(onRemove).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "openrouter" }),
      "sk-new",
    );
  });

  it("keeps the row expanded while a submit is in flight and collapses on success", () => {
    const onSubmit = vi.fn();
    const { rerender, baseProps } = renderModalControlled({ onSubmit });

    fireEvent.click(screen.getByText("OpenRouter"));
    fireEvent.change(screen.getByLabelText("OpenRouter API key"), {
      target: { value: "sk-new" },
    });
    fireEvent.click(screen.getByText("Save"));
    // Still expanded: submitting has not started resolving yet.
    expect(screen.queryByLabelText("OpenRouter API key")).not.toBeNull();

    // In flight, then resolved without error → the row collapses.
    rerender({ ...baseProps, onSubmit, submitting: true });
    expect(screen.queryByLabelText("OpenRouter API key")).not.toBeNull();
    rerender({ ...baseProps, onSubmit, submitting: false, error: null });
    expect(screen.queryByLabelText("OpenRouter API key")).toBeNull();
  });

  it("keeps the row expanded and shows the error when a submit fails", () => {
    const onSubmit = vi.fn();
    const { rerender, baseProps } = renderModalControlled({ onSubmit });

    fireEvent.click(screen.getByText("OpenRouter"));
    fireEvent.change(screen.getByLabelText("OpenRouter API key"), {
      target: { value: "sk-new" },
    });
    fireEvent.click(screen.getByText("Save"));

    rerender({ ...baseProps, onSubmit, submitting: true });
    rerender({
      ...baseProps,
      onSubmit,
      submitting: false,
      error: "Could not add the API key.",
    });
    // Failure keeps the row expanded and the message lands in role=alert.
    expect(screen.queryByLabelText("OpenRouter API key")).not.toBeNull();
    expect(screen.getByRole("alert").textContent).toContain(
      "Could not add the API key.",
    );
  });

  it("resets the key draft when a row is expanded", () => {
    renderModal();

    fireEvent.click(screen.getByText("OpenRouter"));
    fireEvent.change(screen.getByLabelText("OpenRouter API key"), {
      target: { value: "sk-draft" },
    });
    // Collapse, then re-open: expanding resets the draft (design-handoff v2).
    fireEvent.click(screen.getByText("OpenRouter"));
    expect(screen.queryByLabelText("OpenRouter API key")).toBeNull();

    fireEvent.click(screen.getByText("OpenRouter"));
    expect(
      (screen.getByLabelText("OpenRouter API key") as HTMLInputElement).value,
    ).toBe("");
  });

  it("only one row expands at a time", () => {
    renderModal();

    fireEvent.click(screen.getByText("OpenRouter"));
    expect(screen.queryByLabelText("OpenRouter API key")).not.toBeNull();

    fireEvent.click(screen.getByText("Anthropic"));
    expect(screen.queryByLabelText("Anthropic API key")).not.toBeNull();
    expect(screen.queryByLabelText("OpenRouter API key")).toBeNull();
  });

  it("renders a submit failure inline on the selected row", () => {
    renderModal({ error: "Duplicate selection source" });

    // The error belongs to the expanded row only.
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByText("OpenRouter"));
    expect(screen.getByRole("alert").textContent).toBe("Duplicate selection source");
  });

  it("does not submit an empty paste field", () => {
    const onSubmit = vi.fn();
    renderModal({ onSubmit });

    fireEvent.click(screen.getByText("OpenRouter"));
    fireEvent.click(screen.getByText("Save"));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
