/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatInputControlRow } from "#product/components/workspace/chat/input/ChatInputControlRow";
import type { ModelSelectorProps } from "#product/lib/domain/chat/models/model-selector-types";
import type { LiveSessionControlDescriptor } from "#product/lib/domain/chat/session-controls/session-controls";

// Mock hooks that depend on app providers / external packages
vi.mock("#product/hooks/activity/derived/use-session-goal", () => ({
  useSessionGoal: () => null,
}));
vi.mock("#product/stores/activity/goal-bar-store", () => ({
  useGoalBarStore: () => vi.fn(),
}));
vi.mock("#product/hooks/cloud/derived/use-composer-integrations-state", () => ({
  useComposerIntegrationsState: () => ({ mode: "hidden", connectedCount: 0, providers: [], reauthLabel: null }),
}));
Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: vi.fn(),
});

afterEach(() => {
  cleanup();
});

function createModelSelectorProps(overrides?: Partial<ModelSelectorProps>): ModelSelectorProps {
  return {
    connectionState: "healthy",
    currentModel: {
      kind: "claude",
      displayName: "Opus 4.1",
      pendingState: null,
    },
    groups: [
      {
        kind: "claude",
        providerDisplayName: "Claude Code",
        models: [
          { kind: "claude", modelId: "opus-4.1", displayName: "Opus 4.1", actionKind: "select", isSelected: true, isUnsupported: false },
          { kind: "claude", modelId: "sonnet-4", displayName: "Sonnet 4", actionKind: "select", isSelected: false, isUnsupported: false },
        ],
      },
      {
        kind: "codex",
        providerDisplayName: "Proliferate",
        models: [
          { kind: "codex", modelId: "gpt-5.5", displayName: "GPT 5.5", actionKind: "open_new_chat", isSelected: false, isUnsupported: false },
        ],
      },
    ],
    hasAgents: true,
    isLoading: false,
    onSelect: vi.fn(),
    ...overrides,
  };
}

function createControls(): LiveSessionControlDescriptor[] {
  return [
    {
      key: "collaboration_mode",
      label: "Mode",
      detail: "Default",
      rawConfigId: "collaboration_mode",
      settable: true,
      pendingState: null,
      kind: "select",
      options: [
        { value: "default", label: "Default", selected: true },
        { value: "plan", label: "Plan", selected: false },
      ],
      onSelect: vi.fn(),
    },
    {
      key: "effort",
      label: "Reasoning effort",
      detail: "Medium",
      rawConfigId: "effort",
      settable: true,
      pendingState: null,
      kind: "select",
      options: [
        { value: "low", label: "Low", selected: false },
        { value: "medium", label: "Medium", selected: true },
        { value: "high", label: "High", selected: false },
      ],
      onSelect: vi.fn(),
    },
    {
      key: "fast_mode",
      label: "Fast mode",
      detail: "Off",
      rawConfigId: "fast_mode",
      settable: true,
      pendingState: null,
      kind: "toggle",
      enabledValue: "on",
      disabledValue: "off",
      isEnabled: false,
      options: [
        { value: "off", label: "Off", selected: true },
        { value: "on", label: "On", selected: false },
      ],
      onSelect: vi.fn(),
    },
  ];
}

function renderControlRow(overrides?: Partial<Parameters<typeof ChatInputControlRow>[0]>) {
  return render(
    <MemoryRouter>
      <ChatInputControlRow
        runtimeControlsDisabled={false}
        modelSelectorProps={createModelSelectorProps()}
        agentKind="claude"
        sessionConfigControls={createControls()}
        isEditingQueuedPrompt={false}
        chatDisabled={false}
        isSubmitting={false}
        supportsAttachments
        canAttachFiles
        activeSessionId="test-session"
        onAttachFile={vi.fn()}
        isRunning={false}
        isEmpty
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

describe("ChatInputControlRow", () => {
  it("renders model selector with display name", () => {
    renderControlRow();
    expect(screen.getByText("Opus 4.1")).toBeTruthy();
  });

  it("folds reasoning effort into the model selector", () => {
    renderControlRow();
    const selector = screen.getByRole("button", {
      name: "Model and reasoning: Opus 4.1, Medium, Fast mode: Default",
    });
    expect(selector.textContent).toContain("Opus 4.1");
    expect(selector.textContent).toContain("Medium");
    expect(screen.queryByRole("button", { name: "Reasoning: Medium" })).toBeNull();
  });

  it("opens a compact root with nested Model, Effort, and Speed rows", () => {
    renderControlRow();

    fireEvent.pointerDown(screen.getByRole("button", {
      name: "Model and reasoning: Opus 4.1, Medium, Fast mode: Default",
    }), { button: 0, ctrlKey: false });

    expect(document.querySelector("[data-composer-model-menu]")?.textContent)
      .toContain("Model");
    expect(document.querySelector('[data-session-config-control="effort"]')?.textContent)
      .toContain("Effort");
    expect(document.querySelector('[data-session-config-control="fast_mode"]')?.textContent)
      .toContain("Speed");
    expect(document.querySelector("[data-model-option]")).toBeNull();

    fireEvent.click(document.querySelector<HTMLElement>("[data-composer-model-menu]")!);
    expect(document.querySelector('[data-model-option="opus-4.1"]')).not.toBeNull();
  });

  it("renders working mode as plain text with no disclosure chevron", () => {
    renderControlRow();
    const mode = screen.getByRole("button", { name: "Mode: Default" });
    expect(screen.getByText("Default")).toBeTruthy();
    expect(mode.querySelector("svg")).toBeNull();
  });

  it("does not imply disclosure for a non-settable working mode", () => {
    const controls = createControls();
    const modeControl = controls.find((control) => control.key === "collaboration_mode")!;
    modeControl.settable = false;
    renderControlRow({ sessionConfigControls: controls });

    const mode = screen.getByRole("button", { name: "Default" });
    expect(mode).toHaveProperty("disabled", true);
    expect(mode.querySelector("svg")).toBeNull();
  });

  it("orders the combined selector before working mode without separate tuning controls", () => {
    renderControlRow();

    const model = screen.getByRole("button", {
      name: "Model and reasoning: Opus 4.1, Medium, Fast mode: Default",
    });
    const mode = screen.getByRole("button", { name: "Mode: Default" });

    expect(model.compareDocumentPosition(mode) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reasoning: Medium" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Fast mode: Default" })).toBeNull();
  });

  it("renders plus button for file attach", () => {
    renderControlRow();
    const addButton = screen.getByRole("button", { name: "Add file" });
    expect(addButton.querySelector("svg")?.className.baseVal).toContain("icon-control");
  });

  it("uses control-sized optics for the visible primary composer actions", () => {
    renderControlRow();

    const model = screen.getByRole("button", {
      name: "Model and reasoning: Opus 4.1, Medium, Fast mode: Default",
    });
    const integrations = screen.getByRole("button", { name: /connected integrations/i });
    const send = screen.getByRole("button", { name: /Send/ });

    for (const control of [model, integrations, send]) {
      expect(control.querySelector("svg")?.className.baseVal).toContain("icon-control");
    }
  });

  it("disables plus button when cannot attach", () => {
    renderControlRow({ canAttachFiles: false });
    const addButton = screen.getByRole("button", { name: "Add file" });
    expect(addButton).toHaveProperty("disabled", true);
  });

  it("hides plus button when editing queued prompt", () => {
    renderControlRow({ isEditingQueuedPrompt: true });
    expect(screen.queryByRole("button", { name: "Add file" })).toBeNull();
  });

  it("calls onAttachFile directly on plus button click", () => {
    const onAttachFile = vi.fn();
    renderControlRow({ onAttachFile });
    fireEvent.click(screen.getByRole("button", { name: "Add file" }));
    expect(onAttachFile).toHaveBeenCalledTimes(1);
  });

  it("opens the Effort submenu and selects an explicit option", () => {
    const controls = createControls();
    const effortControl = controls.find((c) => c.key === "effort")!;
    renderControlRow({ sessionConfigControls: controls });

    fireEvent.pointerDown(screen.getByRole("button", {
      name: "Model and reasoning: Opus 4.1, Medium, Fast mode: Default",
    }), { button: 0, ctrlKey: false });
    const effortMenu = document.querySelector<HTMLElement>('[data-session-config-control="effort"]')!;
    expect(effortMenu.getAttribute("data-session-config-selected")).toBe("medium");
    fireEvent.click(effortMenu);
    fireEvent.click(screen.getByRole("menuitem", { name: "High" }));

    expect(effortControl.onSelect).toHaveBeenCalledWith("high");
  });

  it("opens the Speed submenu and selects Fast", () => {
    const controls = createControls();
    const fastControl = controls.find((control) => control.key === "fast_mode")!;
    renderControlRow({ sessionConfigControls: controls });

    fireEvent.pointerDown(screen.getByRole("button", {
      name: "Model and reasoning: Opus 4.1, Medium, Fast mode: Default",
    }), { button: 0, ctrlKey: false });
    const fastOption = document.querySelector('[data-session-config-control="fast_mode"]');
    expect(fastOption?.getAttribute("data-session-config-selected")).toBe("off");
    fireEvent.click(fastOption!);
    const fastChoice = document.querySelector<HTMLElement>('[data-session-config-option="fast_mode:on"]')!;
    expect(fastChoice.textContent).toContain("Fast");
    fireEvent.click(fastChoice);

    expect(fastControl.onSelect).toHaveBeenCalledWith("on");
  });

  it("offers two-level reasoning in the popup when effort is unavailable", () => {
    const controls = createControls().filter((control) => control.key !== "effort");
    const reasoningControl: LiveSessionControlDescriptor = {
      key: "reasoning",
      label: "Reasoning",
      detail: "On",
      rawConfigId: "reasoning",
      settable: true,
      pendingState: null,
      kind: "toggle",
      enabledValue: "on",
      disabledValue: "off",
      isEnabled: true,
      options: [
        { value: "off", label: "Off", selected: false },
        { value: "on", label: "On", selected: true },
      ],
      onSelect: vi.fn(),
    };
    controls.push(reasoningControl);
    renderControlRow({ sessionConfigControls: controls });

    fireEvent.pointerDown(screen.getByRole("button", {
      name: "Model and reasoning: Opus 4.1, On, Fast mode: Default",
    }), { button: 0, ctrlKey: false });
    fireEvent.click(document.querySelector<HTMLElement>('[data-session-config-control="reasoning"]')!);
    fireEvent.click(screen.getByRole("menuitem", { name: "Off" }));
    expect(reasoningControl.onSelect).toHaveBeenCalledWith("off");
    expect(screen.queryByRole("button", { name: "Reasoning: On" })).toBeNull();
  });

  it("shows non-settable reasoning effort as disabled popup choices", () => {
    const controls = createControls();
    const effortControl = controls.find((control) => control.key === "effort")!;
    effortControl.settable = false;
    renderControlRow({ sessionConfigControls: controls });

    fireEvent.pointerDown(screen.getByRole("button", {
      name: "Model and reasoning: Opus 4.1, Medium, Fast mode: Default",
    }), { button: 0, ctrlKey: false });

    fireEvent.click(document.querySelector<HTMLElement>('[data-session-config-control="effort"]')!);
    expect(screen.getByRole("menuitem", { name: "High" }).hasAttribute("data-disabled"))
      .toBe(true);
  });
});
