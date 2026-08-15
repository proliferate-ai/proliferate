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
vi.mock("#product/hooks/chat/derived/use-active-session-usage", () => ({
  useActiveSessionUsage: () => null,
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

  it("renders the effort stepper as a six-bar ladder", () => {
    renderControlRow();
    const reasoning = screen.getByRole("button", { name: "Reasoning: Medium" });
    expect(reasoning.getAttribute("title")?.startsWith("Reasoning: Medium")).toBe(true);
    expect(reasoning.className).toContain("h-6");
    const ladder = reasoning.querySelector("[data-reasoning-effort-ladder]");
    expect(ladder?.querySelectorAll("rect").length).toBe(6);
    expect(screen.getByText("Medium").className).not.toContain("sr-only");
  });

  it("does not reserve a pending glyph beside reasoning", () => {
    const controls = createControls();
    const effortControl = controls.find((control) => control.key === "effort")!;
    effortControl.pendingState = "queued";

    renderControlRow({ sessionConfigControls: controls });

    // The ladder is the trigger's only glyph: a pending clock beside it would
    // be a second svg inside the stepper's tooltip wrapper.
    const reasoning = screen.getByRole("button", { name: "Reasoning: Medium" });
    expect(reasoning.closest("span")?.querySelectorAll("svg").length).toBe(1);
  });

  it("renders working mode as an icon-only badge with no word at any width", () => {
    renderControlRow();
    const mode = screen.getByRole("button", { name: "Mode: Default" });
    expect(mode.querySelector("svg")).not.toBeNull();
    // The badge paints no word at all; the mode name survives only as the
    // aria-label the getByRole query above matched.
    expect(mode.textContent).toBe("");
    expect(mode.getAttribute("aria-label")).toContain("Default");
  });

  it("disables the mode badge for a non-settable working mode", () => {
    const controls = createControls();
    const modeControl = controls.find((control) => control.key === "collaboration_mode")!;
    modeControl.settable = false;
    renderControlRow({ sessionConfigControls: controls });

    expect(screen.getByRole("button", { name: "Mode: Default" }))
      .toHaveProperty("disabled", true);
  });

  it("caps the model pill by its wrapper so it cannot paint over the mode pill", () => {
    renderControlRow();

    // Both bounds in one arbitrary value: the 15rem identity budget AND the
    // wrapper width. A bare rem cap replaces the primitive's max-w-full in
    // tailwind-merge, and the pill's column-flex wrapper does not otherwise
    // constrain the button — it overflows onto the mode pill instead of
    // truncating.
    const model = screen.getByRole("button", { name: "Model: Opus 4.1" });
    expect(model.className).toContain("max-w-[min(15rem,100%)]");
  });

  it("mounts no trailing pending slot while a mode change is submitting", () => {
    const controls = createControls();
    controls[0] = { ...controls[0], pendingState: "submitting" };
    renderControlRow({ sessionConfigControls: controls });

    // Submitting renders no glyph, so the trailing wrapper must not mount:
    // a zero-width flex item still claims the pill's gap, pushing the compact
    // icon off-center and snapping the width when the pending state clears.
    const mode = screen.getByRole("button", { name: "Mode: Default" });
    expect(mode.querySelector(".ml-auto")).toBeNull();
  });

  it("keeps the queued clock beside the mode badge", () => {
    const controls = createControls();
    controls[0] = { ...controls[0], pendingState: "queued" };
    renderControlRow({ sessionConfigControls: controls });

    // The badge is icon-only, so the clock is its sibling rather than a
    // trailing slot inside the pill (which would push the glyph off-center).
    const mode = screen.getByRole("button", { name: "Mode: Default" });
    expect(mode.querySelector(".ml-auto")).toBeNull();
    expect(mode.nextElementSibling?.tagName.toLowerCase()).toBe("svg");
  });

  it("steps the working mode to the next value on click", () => {
    const controls = createControls();
    const modeControl = controls.find((control) => control.key === "collaboration_mode")!;
    renderControlRow({ sessionConfigControls: controls });

    const mode = screen.getByRole("button", { name: "Mode: Default" });
    expect(mode.getAttribute("data-session-mode-next")).toBe("plan");
    fireEvent.click(mode);
    expect(modeControl.onSelect).toHaveBeenCalledWith("plan");
  });

  it("hides the reasoning level word under the compact tier, keeping the ladder", () => {
    renderControlRow();

    const label = screen.getByText("Medium");
    expect(label.closest('[class*="@max-[32rem]:hidden"]')).not.toBeNull();
    const reasoning = screen.getByRole("button", { name: "Reasoning: Medium" });
    expect(
      reasoning.querySelector("[data-reasoning-effort-ladder]")
        ?.closest('[class*="@max-[32rem]:hidden"]'),
    ).toBeNull();
  });

  it("orders model, fast mode, reasoning stepper, and mode badge in the visible row", () => {
    renderControlRow();

    const model = screen.getByRole("button", { name: "Model: Opus 4.1" });
    const fast = screen.getByRole("button", { name: "Fast mode: Slow" });
    const reasoning = screen.getByRole("button", { name: "Reasoning: Medium" });
    const mode = screen.getByRole("button", { name: "Mode: Default" });

    expect(model.compareDocumentPosition(fast) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    expect(fast.compareDocumentPosition(reasoning) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    expect(reasoning.compareDocumentPosition(mode) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
  });

  it("renders no integrations control while every integration is healthy", () => {
    renderControlRow();
    expect(screen.queryByRole("button", { name: /integrations/i })).toBeNull();
  });

  it("renders plus button for file attach", () => {
    renderControlRow();
    const addButton = screen.getByRole("button", { name: "Add file" });
    expect(addButton.querySelector("svg")?.className.baseVal).toContain("icon-control");
  });

  it("uses control-sized optics for the visible primary composer actions", () => {
    renderControlRow();

    const model = screen.getByRole("button", { name: "Model: Opus 4.1" });
    const fast = screen.getByRole("button", { name: "Fast mode: Slow" });
    const send = screen.getByRole("button", { name: /Send/ });

    for (const control of [model, fast, send]) {
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

  it("effort bars step on click", () => {
    const controls = createControls();
    const effortControl = controls.find((c) => c.key === "effort")!;
    renderControlRow({ sessionConfigControls: controls });

    const barsButton = screen.getByRole("button", { name: "Reasoning: Medium" });
    fireEvent.click(barsButton);
    expect(effortControl.onSelect).toHaveBeenCalledWith("high");
  });

  it("visually distinguishes Fast off and on while preserving its accessible state", () => {
    const controls = createControls();
    const fastControl = controls.find((control) => control.key === "fast_mode")!;
    const { rerender } = renderControlRow({ sessionConfigControls: controls });

    const offButton = screen.getByRole("button", { name: "Fast mode: Slow" });
    expect(offButton.querySelector("svg")?.getAttribute("class")).toContain("opacity-100");
    expect(offButton.querySelector("svg")?.getAttribute("class")).toContain("fill-none");
    expect(offButton.querySelector("svg")?.getAttribute("class")).toContain("stroke-current");

    fastControl.isEnabled = true;
    fastControl.detail = "On";
    fastControl.options = fastControl.options.map((option) => ({
      ...option,
      selected: option.value === "on",
    }));
    rerender(
      <MemoryRouter>
        <ChatInputControlRow
          runtimeControlsDisabled={false}
          modelSelectorProps={createModelSelectorProps()}
          agentKind="claude"
          sessionConfigControls={controls}
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
        />
      </MemoryRouter>,
    );

    const onButton = screen.getByRole("button", { name: "Fast mode: Fast" });
    expect(onButton.className).toContain("bg-hover");
    expect(onButton.querySelector("svg")?.getAttribute("class")).toContain("fill-current");
    expect(onButton.querySelector("svg")?.getAttribute("class")).toContain("stroke-none");
    expect(onButton.querySelector("svg")?.getAttribute("class")).toContain("opacity-100");
  });

  it("renders two-level reasoning with bars when effort is unavailable", () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Reasoning: On" }));
    expect(reasoningControl.onSelect).toHaveBeenCalledWith("off");
    expect(screen.queryByRole("button", { name: "More configuration options" })).toBeNull();
  });

  it("shows non-settable reasoning effort as disabled bars", () => {
    const controls = createControls();
    const effortControl = controls.find((control) => control.key === "effort")!;
    effortControl.settable = false;
    renderControlRow({ sessionConfigControls: controls });

    expect(screen.getByRole("button", { name: "Reasoning: Medium" }))
      .toHaveProperty("disabled", true);
  });
});
