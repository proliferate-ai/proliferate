/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { ComposerModelSelectorControl } from "#product/components/workspace/chat/input/ComposerModelSelectorControl";
import type { ModelSelectorProps } from "#product/lib/domain/chat/models/model-selector-types";
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

function createKeyboardModelSelectorProps(): ModelSelectorProps {
  return {
    connectionState: "healthy",
    currentModel: { kind: "claude", displayName: "Haiku 4.5", pendingState: null },
    groups: [
      {
        kind: "claude",
        providerDisplayName: "Claude Code",
        models: [
          { kind: "claude", modelId: "haiku", displayName: "Haiku 4.5", actionKind: "select", isSelected: true, isUnsupported: false },
          { kind: "claude", modelId: "sonnet", displayName: "Sonnet 4.5", actionKind: "select", isSelected: false, isUnsupported: false },
        ],
      },
    ],
    hasAgents: true,
    isLoading: false,
    onSelect: vi.fn(),
  };
}

function openModelOptions(container: HTMLElement) {
  const trigger = container.querySelector<HTMLElement>("[data-composer-model-trigger]")!;
  fireEvent.pointerDown(trigger, {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(trigger);
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
  const refusedRow = document.querySelector<HTMLButtonElement>('[data-model-option="opus-9"]');
  expect(refusedRow).not.toBeNull();
  expect(refusedRow?.getAttribute("data-model-unsupported")).toBe("true");
  expect(refusedRow?.disabled).toBe(true);
  expect(refusedRow?.textContent).toContain("Not supported on this target");

  const supportedRow = document.querySelector<HTMLButtonElement>('[data-model-option="haiku"]');
  expect(supportedRow?.disabled).toBe(false);

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

it("toggles the active model picker and restores the composer caret", async () => {
  vi.stubGlobal("navigator", { platform: "MacIntel", userAgent: "Mac OS X" });
  const props = createKeyboardModelSelectorProps();
  const { container } = render(
    <MemoryRouter>
      <ShortcutDispatcher />
      <div data-focus-zone="chat">
        <textarea data-chat-composer-editor defaultValue="Keep typing" />
        <ComposerModelSelectorControl
          modelSelectorProps={props}
          keyboardShortcutEnabled
        />
      </div>
    </MemoryRouter>,
  );
  const prompt = container.querySelector<HTMLTextAreaElement>("[data-chat-composer-editor]")!;
  prompt.focus();
  prompt.setSelectionRange(4, 4);

  fireEvent.keyDown(prompt, {
    key: "M",
    code: "KeyM",
    ctrlKey: true,
    shiftKey: true,
  });
  expect(
    container.querySelector("[data-composer-model-trigger]")?.getAttribute("data-state"),
  ).toBe("open");

  fireEvent.keyDown(document.activeElement ?? prompt, {
    key: "M",
    code: "KeyM",
    ctrlKey: true,
    shiftKey: true,
  });

  await waitFor(() => {
    expect(
      container.querySelector("[data-composer-model-trigger]")?.getAttribute("data-state"),
    ).toBe("closed");
    expect(document.activeElement).toBe(prompt);
  });
  expect(prompt.selectionStart).toBe(4);
  expect(prompt.selectionEnd).toBe(4);
});

it("restores composer focus when Escape closes the model picker", async () => {
  const props = createKeyboardModelSelectorProps();
  const { container } = render(
    <MemoryRouter>
      <div data-focus-zone="chat">
        <textarea data-chat-composer-editor defaultValue="Keep typing" />
        <ComposerModelSelectorControl
          modelSelectorProps={props}
          keyboardShortcutEnabled
        />
      </div>
    </MemoryRouter>,
  );
  const prompt = container.querySelector<HTMLTextAreaElement>("[data-chat-composer-editor]")!;
  prompt.focus();
  prompt.setSelectionRange(4, 4);

  openModelOptions(container);
  const search = document.querySelector<HTMLInputElement>('input[placeholder="Search models"]')!;
  fireEvent.keyDown(search, { key: "Escape", code: "Escape" });

  await waitFor(() => {
    expect(
      container.querySelector("[data-composer-model-trigger]")?.getAttribute("data-state"),
    ).toBe("closed");
    expect(document.activeElement).toBe(prompt);
  });
  expect(prompt.selectionStart).toBe(4);
  expect(prompt.selectionEnd).toBe(4);
});

it("restores composer focus after Enter selects a searched model", async () => {
  const props = createKeyboardModelSelectorProps();
  const { container } = render(
    <MemoryRouter>
      <div data-focus-zone="chat">
        <textarea data-chat-composer-editor defaultValue="Keep typing" />
        <ComposerModelSelectorControl
          modelSelectorProps={props}
          keyboardShortcutEnabled
        />
      </div>
    </MemoryRouter>,
  );
  const prompt = container.querySelector<HTMLTextAreaElement>("[data-chat-composer-editor]")!;
  prompt.focus();
  prompt.setSelectionRange(4, 4);

  openModelOptions(container);
  const search = document.querySelector<HTMLInputElement>('input[placeholder="Search models"]')!;
  fireEvent.keyDown(search, { key: "ArrowDown", code: "ArrowDown" });
  fireEvent.keyDown(search, { key: "Enter", code: "Enter" });

  expect(props.onSelect).toHaveBeenCalledWith({ kind: "claude", modelId: "sonnet" });
  await waitFor(() => {
    expect(
      container.querySelector("[data-composer-model-trigger]")?.getAttribute("data-state"),
    ).toBe("closed");
    expect(document.activeElement).toBe(prompt);
  });
});

it("restores composer focus after a keyboard-activated model row", async () => {
  const props = createKeyboardModelSelectorProps();
  const { container } = render(
    <MemoryRouter>
      <div data-focus-zone="chat">
        <textarea data-chat-composer-editor defaultValue="Keep typing" />
        <ComposerModelSelectorControl
          modelSelectorProps={props}
          keyboardShortcutEnabled
        />
      </div>
    </MemoryRouter>,
  );
  const prompt = container.querySelector<HTMLTextAreaElement>("[data-chat-composer-editor]")!;
  prompt.focus();
  prompt.setSelectionRange(4, 4);

  openModelOptions(container);
  const row = document.querySelector<HTMLButtonElement>('[data-model-option="sonnet"]')!;
  row.focus();
  fireEvent.keyDown(row, { key: "Enter", code: "Enter" });
  fireEvent.click(row);

  expect(props.onSelect).toHaveBeenCalledWith({ kind: "claude", modelId: "sonnet" });
  await waitFor(() => {
    expect(document.activeElement).toBe(prompt);
  });
});

it("keeps pointer selection focus-neutral", async () => {
  const props = createKeyboardModelSelectorProps();
  const { container } = render(
    <MemoryRouter>
      <div data-focus-zone="chat">
        <textarea data-chat-composer-editor defaultValue="Keep typing" />
        <ComposerModelSelectorControl
          modelSelectorProps={props}
          keyboardShortcutEnabled
        />
      </div>
    </MemoryRouter>,
  );
  const prompt = container.querySelector<HTMLTextAreaElement>("[data-chat-composer-editor]")!;
  prompt.focus();

  openModelOptions(container);
  fireEvent.click(document.querySelector<HTMLButtonElement>('[data-model-option="sonnet"]')!);

  await waitFor(() => {
    expect(
      container.querySelector("[data-composer-model-trigger]")?.getAttribute("data-state"),
    ).toBe("closed");
  });
  expect(document.activeElement).not.toBe(prompt);
});

it("ignores the shortcut and Escape focus restore behind another route", async () => {
  const props = createKeyboardModelSelectorProps();
  const { container } = render(
    <MemoryRouter initialEntries={["/settings"]}>
      <ShortcutDispatcher />
      <div aria-hidden="true">
        <div data-focus-zone="chat">
          <textarea data-chat-composer-editor defaultValue="Hidden draft" />
          <ComposerModelSelectorControl
            modelSelectorProps={props}
            keyboardShortcutEnabled
          />
        </div>
      </div>
    </MemoryRouter>,
  );
  const prompt = container.querySelector<HTMLTextAreaElement>("[data-chat-composer-editor]")!;
  prompt.focus();

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
  expect(shortcut.defaultPrevented).toBe(false);

  openModelOptions(container);
  const search = document.querySelector<HTMLInputElement>('input[placeholder="Search models"]')!;
  fireEvent.keyDown(search, { key: "Escape", code: "Escape" });

  await waitFor(() => {
    expect(
      container.querySelector("[data-composer-model-trigger]")?.getAttribute("data-state"),
    ).toBe("closed");
  });
  expect(document.activeElement).not.toBe(prompt);
});
