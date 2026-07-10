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

  it("renders effort bars control", () => {
    renderControlRow();
    // The LevelBarsButton renders with the current level's label
    expect(screen.getByText("Medium")).toBeTruthy();
  });

  it("renders mode control", () => {
    renderControlRow();
    expect(screen.getByText("Default")).toBeTruthy();
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

  it("effort bars step on click", () => {
    const controls = createControls();
    const effortControl = controls.find((c) => c.key === "effort")!;
    renderControlRow({ sessionConfigControls: controls });

    // The LevelBarsButton is rendered with label "Medium"
    const barsButton = screen.getByText("Medium").closest("button")!;
    fireEvent.click(barsButton);
    // Clicking should advance from index 1 (Medium) to index 2 (High)
    expect(effortControl.onSelect).toHaveBeenCalledWith("high");
  });

  it("does not render overflow when no extra controls exist", () => {
    // Only effort, fast_mode, and collaboration_mode — all excluded from overflow
    renderControlRow();
    expect(screen.queryByRole("button", { name: "More configuration options" })).toBeNull();
  });

  it("renders overflow button when extra controls exist", () => {
    const controls = createControls();
    // "reasoning" is NOT excluded from overflow
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
