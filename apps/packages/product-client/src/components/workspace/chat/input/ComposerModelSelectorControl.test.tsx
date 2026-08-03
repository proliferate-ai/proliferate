/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { ComposerModelSelectorControl } from "#product/components/workspace/chat/input/ComposerModelSelectorControl";
import type { ModelSelectorProps } from "#product/lib/domain/chat/models/model-selector-types";
import type { LiveSessionControlDescriptor } from "#product/lib/domain/chat/session-controls/session-controls";
import { modelUnsupportedControlMessage } from "#product/lib/domain/chat/models/model-support-refusals";
import { useModelSupportStore } from "#product/stores/chat/model-support-store";
import { useShortcutDispatcher } from "#product/hooks/shortcuts/lifecycle/use-shortcut-dispatcher";
import { clearShortcutHandlerRegistryForTests } from "#product/lib/domain/shortcuts/registry";

Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: vi.fn(),
});

afterEach(() => {
  cleanup();
  clearShortcutHandlerRegistryForTests();
  useModelSupportStore.setState({ refusalsByKey: {}, pickerRequestNonce: 0 });
  vi.unstubAllGlobals();
});

function ShortcutDispatcher() {
  useShortcutDispatcher();
  return null;
}

function openModelOptions(container: HTMLElement) {
  fireEvent.pointerDown(container.querySelector<HTMLElement>("[data-composer-model-trigger]")!, {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(document.querySelector<HTMLElement>("[data-composer-model-menu]")!);
}

it("identifies model rows by both harness kind and model id", () => {
  const props: ModelSelectorProps = {
    connectionState: "healthy",
    currentModel: { kind: "claude", displayName: "Opus 4.1", pendingState: null },
    groups: [
      {
        kind: "claude",
        providerDisplayName: "Claude Code",
        models: [
          { kind: "claude", modelId: "opus-4.1", displayName: "Opus 4.1", actionKind: "select", isSelected: true, isUnsupported: false },
        ],
      },
      {
        kind: "codex",
        providerDisplayName: "Codex",
        models: [
          { kind: "codex", modelId: "gpt-5.5", displayName: "GPT 5.5", actionKind: "open_new_chat", isSelected: false, isUnsupported: false },
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

  openModelOptions(container);
  const codexRow = document.querySelector('[data-model-kind="codex"][data-model-option="gpt-5.5"]');
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
          { kind: "claude", modelId: "claude-sonnet-4-5", displayName: "Sonnet 4.5", actionKind: "select", isSelected: true, isUnsupported: false },
          { kind: "claude", modelId: "haiku", displayName: "Haiku 4.5", actionKind: "update_current_chat", isSelected: false, isUnsupported: false },
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

it("marks a refused row as disabled and explains it, rather than hiding the model", () => {
  const onSelect = vi.fn();
  const props: ModelSelectorProps = {
    connectionState: "healthy",
    currentModel: { kind: "claude", displayName: "Opus 9", pendingState: null },
    groups: [
      {
        kind: "claude",
        providerDisplayName: "Claude Code",
        models: [
          { kind: "claude", modelId: "opus-9", displayName: "Opus 9", actionKind: "select", isSelected: true, isUnsupported: true },
          { kind: "claude", modelId: "haiku", displayName: "Haiku 4.5", actionKind: "select", isSelected: false, isUnsupported: false },
        ],
      },
    ],
    hasAgents: true,
    isLoading: false,
    onSelect,
  };

  const { container } = render(
    <MemoryRouter>
      <ComposerModelSelectorControl modelSelectorProps={props} />
    </MemoryRouter>,
  );

  openModelOptions(container);
  const refusedRow = document.querySelector<HTMLElement>('[data-model-option="opus-9"]');
  expect(refusedRow).not.toBeNull();
  expect(refusedRow?.getAttribute("data-model-unsupported")).toBe("true");
  expect(refusedRow?.hasAttribute("data-disabled")).toBe(true);
  expect(refusedRow?.textContent).toContain("Not supported on this target");

  const supportedRow = document.querySelector<HTMLElement>('[data-model-option="haiku"]');
  expect(supportedRow?.hasAttribute("data-disabled")).toBe(false);

  if (refusedRow) fireEvent.click(refusedRow);
  expect(onSelect).not.toHaveBeenCalled();
});

it("pins the refusal to the model control and points the trigger at it", () => {
  const props: ModelSelectorProps = {
    connectionState: "healthy",
    currentModel: { kind: "claude", displayName: "Opus 9", pendingState: null },
    groups: [
      {
        kind: "claude",
        providerDisplayName: "Claude Code",
        models: [
          { kind: "claude", modelId: "opus-9", displayName: "Opus 9", actionKind: "select", isSelected: true, isUnsupported: true },
        ],
      },
    ],
    hasAgents: true,
    isLoading: false,
    onSelect: vi.fn(),
    // The real projection rather than a hand-copied sentence: this test asserts
    // the control surfaces the message, so a literal here would keep passing
    // after the copy itself changed underneath it.
    unsupportedSelectionMessage: modelUnsupportedControlMessage({
      modelDisplayName: "Opus 9",
      targetLabel: "proliferate",
    }),
  };

  const { container } = render(
    <MemoryRouter>
      <ComposerModelSelectorControl modelSelectorProps={props} />
    </MemoryRouter>,
  );

  const alert = container.querySelector('[role="alert"]');
  expect(alert?.textContent).toContain("Opus 9");
  expect(alert?.textContent).toContain("proliferate");

  const trigger = container.querySelector("[data-composer-model-trigger]");
  expect(trigger?.getAttribute("aria-invalid")).toBe("true");
  expect(trigger?.getAttribute("aria-describedby")).toBe(alert?.getAttribute("id"));
});

it("says nothing when no refusal applies to the current selection", () => {
  const props: ModelSelectorProps = {
    connectionState: "healthy",
    currentModel: { kind: "claude", displayName: "Haiku 4.5", pendingState: null },
    groups: [
      {
        kind: "claude",
        providerDisplayName: "Claude Code",
        models: [
          { kind: "claude", modelId: "haiku", displayName: "Haiku 4.5", actionKind: "select", isSelected: true, isUnsupported: false },
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

  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.querySelector("[data-composer-model-trigger]")?.getAttribute("aria-invalid"))
    .toBeNull();
});

it("opens the picker when a refusal asks for it, and again on the next refusal", () => {
  const props: ModelSelectorProps = {
    connectionState: "healthy",
    currentModel: { kind: "claude", displayName: "Haiku 4.5", pendingState: null },
    groups: [
      {
        kind: "claude",
        providerDisplayName: "Claude Code",
        models: [
          { kind: "claude", modelId: "haiku", displayName: "Haiku 4.5", actionKind: "select", isSelected: true, isUnsupported: false },
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
  const menuState = () =>
    container.querySelector("[data-composer-model-trigger]")?.getAttribute("data-state");

  expect(menuState()).toBe("closed");

  act(() => {
    useModelSupportStore.getState().requestPicker();
  });
  expect(menuState()).toBe("open");

  // The user closes it without changing anything; the next refusal must still
  // be able to bring it back, which a latched boolean could not do.
  act(() => {
    useModelSupportStore.setState({ pickerRequestNonce: 1 });
  });
  act(() => {
    useModelSupportStore.getState().requestPicker();
  });
  expect(menuState()).toBe("open");
});

it("opens model options from the active macOS workspace, not a background route", () => {
  vi.stubGlobal("navigator", { platform: "MacIntel", userAgent: "Mac OS X" });
  const props: ModelSelectorProps = {
    connectionState: "healthy",
    currentModel: { kind: "claude", displayName: "Haiku 4.5", pendingState: null },
    groups: [
      {
        kind: "claude",
        providerDisplayName: "Claude Code",
        models: [
          { kind: "claude", modelId: "haiku", displayName: "Haiku 4.5", actionKind: "select", isSelected: true, isUnsupported: false },
        ],
      },
    ],
    hasAgents: true,
    isLoading: false,
    onSelect: vi.fn(),
  };
  const reasoningControl: LiveSessionControlDescriptor = {
    key: "effort",
    label: "Reasoning effort",
    detail: "High",
    rawConfigId: "effort",
    settable: true,
    pendingState: null,
    kind: "select",
    options: [
      { value: "medium", label: "Medium", selected: false },
      { value: "high", label: "High", selected: true },
    ],
    onSelect: vi.fn(),
  };

  const { container, unmount } = render(
    <MemoryRouter>
      <ShortcutDispatcher />
      <ComposerModelSelectorControl
        modelSelectorProps={props}
        reasoningControl={reasoningControl}
        keyboardShortcutEnabled
      />
    </MemoryRouter>,
  );
  const prompt = document.createElement("textarea");
  document.body.append(prompt);
  const shortcut = new KeyboardEvent("keydown", {
    key: "M",
    code: "KeyM",
    ctrlKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });

  act(() => {
    prompt.dispatchEvent(shortcut);
  });

  expect(shortcut.defaultPrevented).toBe(true);
  expect(
    container.querySelector("[data-composer-model-trigger]")?.getAttribute("data-state"),
  ).toBe("open");
  prompt.remove();

  unmount();
  const hidden = render(
    <MemoryRouter initialEntries={["/settings"]}>
      <ShortcutDispatcher />
      <ComposerModelSelectorControl
        modelSelectorProps={props}
        reasoningControl={reasoningControl}
        keyboardShortcutEnabled
      />
    </MemoryRouter>,
  );
  const settingsPrompt = document.createElement("textarea");
  document.body.append(settingsPrompt);
  const backgroundShortcut = new KeyboardEvent("keydown", {
    key: "M",
    code: "KeyM",
    ctrlKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });

  act(() => {
    settingsPrompt.dispatchEvent(backgroundShortcut);
  });

  expect(backgroundShortcut.defaultPrevented).toBe(false);
  expect(
    hidden.container.querySelector("[data-composer-model-trigger]")?.getAttribute("data-state"),
  ).toBe("closed");
  settingsPrompt.remove();
});
