/* @vitest-environment jsdom */

import type { ReactNode } from "react";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { ComposerModelSelectorControl } from "#product/components/workspace/chat/input/ComposerModelSelectorControl";
import type { ModelSelectorProps } from "#product/lib/domain/chat/models/model-selector-types";

vi.mock("@proliferate/ui/primitives/PopoverButton", () => ({
  PopoverButton: ({
    trigger,
    children,
  }: {
    trigger: ReactNode;
    children: (close: () => void) => ReactNode;
  }) => (
    <>
      {trigger}
      {children(() => undefined)}
    </>
  ),
}));

Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: vi.fn(),
});

afterEach(cleanup);

it("identifies model rows by both harness kind and model id", () => {
  const props: ModelSelectorProps = {
    connectionState: "healthy",
    currentModel: { kind: "claude", displayName: "Opus 4.1", pendingState: null },
    groups: [
      {
        kind: "claude",
        providerDisplayName: "Claude Code",
        models: [
          { kind: "claude", modelId: "opus-4.1", displayName: "Opus 4.1", actionKind: "select", isSelected: true },
        ],
      },
      {
        kind: "codex",
        providerDisplayName: "Codex",
        models: [
          { kind: "codex", modelId: "gpt-5.5", displayName: "GPT 5.5", actionKind: "open_new_chat", isSelected: false },
        ],
      },
    ],
    hasAgents: true,
    isLoading: false,
    onSelect: vi.fn(),
  };

  const { container } = render(
    <MemoryRouter>
      <ComposerModelSelectorControl modelSelectorProps={props} />
    </MemoryRouter>,
  );

  const codexRow = container.querySelector('button[data-model-kind="codex"][data-model-option="gpt-5.5"]');
  expect(codexRow).not.toBeNull();
});

it("reports the effective live model when the launch row remains selected", () => {
  const props: ModelSelectorProps = {
    connectionState: "healthy",
    currentModel: { kind: "claude", displayName: "Haiku 4.5", pendingState: null },
    groups: [
      {
        kind: "claude",
        providerDisplayName: "Claude Code",
        models: [
          { kind: "claude", modelId: "claude-sonnet-4-5", displayName: "Sonnet 4.5", actionKind: "select", isSelected: true },
          { kind: "claude", modelId: "haiku", displayName: "Haiku 4.5", actionKind: "update_current_chat", isSelected: false },
        ],
      },
    ],
    hasAgents: true,
    isLoading: false,
    onSelect: vi.fn(),
  };

  const { container } = render(
    <MemoryRouter>
      <ComposerModelSelectorControl modelSelectorProps={props} />
    </MemoryRouter>,
  );

  expect(
    container.querySelector("[data-composer-model-trigger]")?.getAttribute("data-composer-selected-model"),
  ).toBe("haiku");
});
