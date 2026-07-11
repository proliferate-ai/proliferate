/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatInputControlRow } from "./ChatInputControlRow";
import type { ModelSelectorProps } from "@/lib/domain/chat/models/model-selector-types";
import type { LiveSessionControlDescriptor } from "@/lib/domain/chat/session-controls/session-controls";

// Mock hooks that depend on app providers / external packages
vi.mock("@/hooks/activity/derived/use-session-goal", () => ({
  useSessionGoal: () => null,
}));
vi.mock("@/stores/activity/goal-bar-store", () => ({
  useGoalBarStore: () => vi.fn(),
}));
vi.mock("@/hooks/cloud/derived/use-composer-integrations-state", () => ({
  useComposerIntegrationsState: () => ({ mode: "hidden", connectedCount: 0, providers: [], reauthLabel: null }),
}));
vi.mock("@/hooks/sessions/lifecycle/use-runtime-pressure-state", () => ({
  useRuntimePressureState: () => null,
}));
vi.mock("./RuntimePressureIndicator", () => ({
  RuntimePressureIndicator: () => null,
}));

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
          { kind: "claude", modelId: "opus-4.1", displayName: "Opus 4.1", actionKind: "select", isSelected: true },
          { kind: "claude", modelId: "sonnet-4", displayName: "Sonnet 4", actionKind: "select", isSelected: false },
        ],
      },
      {
        kind: "codex",
        providerDisplayName: "Proliferate",
        models: [
          { kind: "codex", modelId: "gpt-5.5", displayName: "GPT 5.5", actionKind: "open_new_chat", isSelected: false },
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

function createAccessModeControl(): LiveSessionControlDescriptor {
  return {
    key: "mode",
    label: "Permissions",
    detail: "Auto",
    rawConfigId: "mode",
    settable: true,
    pendingState: null,
    kind: "select",
    options: [
      { value: "read-only", label: "Read Only", selected: false },
      { value: "auto", label: "Auto", selected: true },
      { value: "full-access", label: "Full Access", selected: false },
    ],
    onSelect: vi.fn(),
  };
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
  it("combines model and reasoning into one clear selector", () => {
    renderControlRow();
    const selector = screen.getByRole("button", {
      name: "Model and reasoning: Opus 4.1, Medium",
    });
    expect(selector.textContent).toContain("Opus 4.1");
    expect(selector.textContent).toContain("Medium");
    expect(screen.queryByRole("button", { name: /Fast mode/i })).toBeNull();
  });

  it("renders working mode as text with a subtle disclosure chevron", () => {
    renderControlRow();
    const mode = screen.getByRole("button", { name: "Mode: Default" });
    expect(screen.getByText("Default")).toBeTruthy();
    expect(mode.querySelectorAll("svg")).toHaveLength(1);
    expect(mode.querySelector('path[d="m6 9 6 6 6-6"]')).toBeTruthy();
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

  it("orders the combined intelligence control before working mode", () => {
    renderControlRow();

    const model = screen.getByRole("button", {
      name: "Model and reasoning: Opus 4.1, Medium",
    });
    const mode = screen.getByRole("button", { name: "Mode: Default" });

    expect(model.compareDocumentPosition(mode) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
  });

  it("renders plus button for file attach", () => {
    renderControlRow();
    expect(screen.getByRole("button", { name: "Add file" })).toBeTruthy();
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

  it("changes reasoning and fast mode inside the combined selector", () => {
    const controls = createControls();
    const effortControl = controls.find((c) => c.key === "effort")!;
    const fastModeControl = controls.find((c) => c.key === "fast_mode")!;
    renderControlRow({ sessionConfigControls: controls });

    fireEvent.click(screen.getByRole("button", {
      name: "Model and reasoning: Opus 4.1, Medium",
    }));
    expect(screen.getByText("Reasoning effort")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "High" }));
    expect(effortControl.onSelect).toHaveBeenCalledWith("high");

    fireEvent.click(screen.getByRole("button", { name: /Fast mode/ }));
    expect(fastModeControl.onSelect).toHaveBeenCalledWith("on");
  });

  it("exposes enabled Fast mode in the combined selector name", () => {
    const controls = createControls();
    const fastControl = controls.find((control) => control.key === "fast_mode")!;
    fastControl.isEnabled = true;
    fastControl.detail = "On";
    fastControl.options = fastControl.options.map((option) => ({
      ...option,
      selected: option.value === "on",
    }));
    renderControlRow({ sessionConfigControls: controls });

    expect(screen.getByRole("button", {
      name: "Model and reasoning: Opus 4.1, Medium, Fast mode on",
    })).toBeTruthy();
  });

  it("does not render overflow when no extra controls exist", () => {
    // Model tuning and collaboration mode each own a visible slot.
    renderControlRow();
    expect(screen.queryByRole("button", { name: "More configuration options" })).toBeNull();
  });

  it("keeps Codex permissions independent from working mode in overflow", () => {
    const controls = [createAccessModeControl(), ...createControls()];
    renderControlRow({ agentKind: "codex", sessionConfigControls: controls });

    expect(screen.getByRole("button", { name: "Mode: Default" })).toBeTruthy();
    expect(screen.queryByText("Auto")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "More configuration options" }));

    expect(screen.getByText("Permissions")).toBeTruthy();
    expect(screen.getByText("Read Only")).toBeTruthy();
    expect(screen.getByText("Auto")).toBeTruthy();
    expect(screen.getByText("Full Access")).toBeTruthy();
  });

  it("renders two-level reasoning in the combined picker when effort is unavailable", () => {
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

    fireEvent.click(screen.getByRole("button", {
      name: "Model and reasoning: Opus 4.1, On",
    }));
    fireEvent.click(screen.getByRole("button", { name: "Off" }));
    expect(reasoningControl.onSelect).toHaveBeenCalledWith("off");
    expect(screen.queryByRole("button", { name: "More configuration options" })).toBeNull();
  });

  it("shows non-settable reasoning effort as disabled picker choices", () => {
    const controls = createControls();
    const effortControl = controls.find((control) => control.key === "effort")!;
    effortControl.settable = false;
    renderControlRow({ sessionConfigControls: controls });

    fireEvent.click(screen.getByRole("button", {
      name: "Model and reasoning: Opus 4.1, Medium",
    }));
    expect(screen.getByRole("button", { name: "Medium" })).toHaveProperty("disabled", true);
  });

  it("renders overflow button when extra controls exist", () => {
    const controls = createControls();
    // Effort owns the single reasoning-level slot, so a second reasoning
    // control remains available as an additional option.
    controls.push({
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
    });
    renderControlRow({ sessionConfigControls: controls });
    expect(screen.getByRole("button", { name: "More configuration options" })).toBeTruthy();
  });

  it("overflow popover stays open on option select", async () => {
    const controls = createControls();
    const reasoningControl = {
      key: "reasoning" as const,
      label: "Reasoning",
      detail: "On",
      rawConfigId: "reasoning",
      settable: true,
      pendingState: null,
      kind: "toggle" as const,
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

    // Open the overflow popover
    fireEvent.click(screen.getByRole("button", { name: "More configuration options" }));

    // The popover should show "Reasoning" section and its options
    expect(screen.getByText("Reasoning")).toBeTruthy();

    // Click an option — popover should remain open
    fireEvent.click(screen.getByText("Off"));
    expect(reasoningControl.onSelect).toHaveBeenCalledWith("off");

    // The popover content should still be visible
    expect(screen.getByText("Reasoning")).toBeTruthy();
  });
});
