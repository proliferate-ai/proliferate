// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeNextScreen } from "#product/components/home/screen/HomeNextScreen";
import { installLocalStorageMock } from "#product/components/home/screen/HomeNextScreen.test-support";
import { resolveModelSelectorEnabled } from "#product/lib/domain/chat/models/model-selector-types";

/**
 * Home's model gate at the screen seam: which notice each gate renders, which
 * of them may say "Finish agent setup", and what a refused Enter does. Split
 * from HomeNextScreen.test.tsx, which owns the composer/target/attachment
 * batteries.
 */

const screenMocks = vi.hoisted(() => {
  const handleHomeAction = vi.fn();
  const launch = vi.fn();
  const clearDraftText = vi.fn();
  const retryModelObservation = vi.fn();
  const navigate = vi.fn();
  const onboardingCards: any[] = [];
  const homeNext = {
    selectedRepository: null,
    repositories: [],
    selectedBranchName: null,
    branchOptions: [],
    branchQuery: {
      isLoading: false,
      isError: false,
    },
    cloudRepoActionBySourceRoot: {},
    cloudRepoTarget: null,
    cloudRepoAction: { kind: "create" },
    modelGroups: [],
    selectedModel: null,
    modeOptions: [],
    effectiveMode: null,
    effectiveModeId: null,
    targetDisabledReason: null,
    modelGate: { kind: "launchable" },
    isCatalogLoading: false,
    hasKnownAgents: true,
    retryModelObservation: () => {},
    retryRejected: false,
    retryPending: false,
    unsupportedHarnessKind: null,
    canLaunchTarget: true,
    effectiveModelSelection: { kind: "codex", modelId: "gpt-5.4" },
    launchTarget: { kind: "cowork" },
  } as any;

  return {
    handleHomeAction,
    launch,
    clearDraftText,
    retryModelObservation,
    navigate,
    onboardingCards,
    homeNext,
    homeNextStateArgs: null as any,
    targetPickerProps: null as any,
    leadingControlsProps: null as any,
    trailingControlsProps: null as any,
    productHost: { desktop: {} as object | null },
  };
});

vi.mock("react-router-dom", () => ({
  useNavigate: () => screenMocks.navigate,
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => screenMocks.productHost,
}));

vi.mock("#product/hooks/home/derived/use-home-next-state", () => ({
  useHomeNextState: (args: any) => {
    screenMocks.homeNextStateArgs = args;
    return screenMocks.homeNext;
  },
}));

vi.mock("#product/hooks/home/derived/use-home-next-launch-controls", () => ({
  useHomeNextLaunchControls: () => ({
    controls: [],
    launchControlValues: {},
  }),
}));

vi.mock("#product/hooks/home/workflows/use-home-next-launch", () => ({
  useHomeNextLaunch: () => ({
    isLaunching: false,
    launch: screenMocks.launch,
  }),
}));

vi.mock("#product/hooks/home/facade/use-home-screen", () => ({
  useHomeScreen: () => ({
    onboardingCards: screenMocks.onboardingCards,
    isAddingRepo: false,
    handleHomeAction: screenMocks.handleHomeAction,
  }),
}));

// The readiness card is sourced from its own hook now (D-R1/D-R2), not from
// useHomeScreen; these files don't exercise readiness-card behavior, so it
// stays off here (covered by use-home-installation-readiness.test.tsx).
vi.mock("#product/hooks/home/derived/use-home-installation-readiness", () => ({
  useHomeInstallationReadiness: () => null,
}));

vi.mock("#product/stores/home/home-draft-handoff-store", () => ({
  useHomeDraftHandoffStore: (selector: (state: {
    draftText: string | null;
    clearDraftText: () => void;
  }) => unknown) => selector({
    draftText: null,
    clearDraftText: screenMocks.clearDraftText,
  }),
}));

vi.mock("#product/components/home/screen/HomeTargetPicker", () => ({
  HomeTargetPicker: (props: any) => {
    screenMocks.targetPickerProps = props;
    return (
      <div data-testid="target-picker">
        {props.desktopTargetsAvailable ? (
          <>
            <button type="button" onClick={() => props.onSelectCowork()}>Mock cowork</button>
            <button type="button" onClick={() => props.onSelectRuntime("local")}>Mock local</button>
          </>
        ) : null}
        <button type="button" onClick={() => props.onSelectRepository("/repo-b")}>
          Mock repo
        </button>
        <button type="button" onClick={() => props.onSelectBranch("feature/sticky")}>
          Mock branch
        </button>
      </div>
    );
  },
}));

vi.mock("#product/components/workspace/chat/input/ChatInputControlRow", () => ({
  ComposerLeadingControls: (props: any) => {
    screenMocks.leadingControlsProps = props;
    // Stands in for ComposerModelSelectorControl's trigger. The real control's
    // ownership of this attribute is pinned in
    // ComposerModelSelectorControl.test.tsx; here it is the focus destination
    // a refused Enter must land on — and it honours the SAME enablement rule
    // the real control does, because an always-enabled stand-in would hide
    // exactly the bug where a refusal focuses a control the user cannot use.
    const enabled = resolveModelSelectorEnabled({
      disabled: false,
      connectionState: props.modelSelectorProps?.connectionState ?? "healthy",
      isLoading: props.modelSelectorProps?.isLoading ?? false,
      hasAgents: props.modelSelectorProps?.hasAgents ?? true,
      availability: props.modelSelectorProps?.availability ?? "ready",
    });
    return (
      <div data-testid="composer-leading-controls">
        <button type="button" data-composer-model-trigger disabled={!enabled}>
          Select model
        </button>
      </div>
    );
  },
  ComposerTrailingControls: (props: any) => {
    screenMocks.trailingControlsProps = props;
    return <div data-testid="composer-trailing-controls" />;
  },
}));

vi.mock("#product/components/workspace/chat/composer/ChatComposerSurface", () => ({
  ChatComposerSurface: ({ children }: { children: ReactNode }) => (
    <div data-testid="composer-surface">{children}</div>
  ),
}));

vi.mock("#product/components/workspace/chat/content/PromptContentRenderer", () => ({
  DraftAttachmentPreviewList: ({ attachments, onRemove }: any) => (
    <div data-testid="draft-attachment-list">
      {attachments.map((attachment: any) => (
        <button
          key={attachment.id}
          type="button"
          onClick={() => onRemove(attachment.id)}
        >
          {`attachment:${attachment.name}`}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("#product/components/workspace/chat/input/ComposerRichTextEditor", () => ({
  ComposerRichTextEditor: ({
    value,
    snapshot,
    onChange,
    onKeyDown,
    canSubmit,
    onSubmit,
    onSubmitRefused,
    disabled,
  }: any) => (
    <textarea
      aria-label="Prompt"
      data-editor-snapshot={snapshot?.payload}
      value={value}
      onChange={(event) => onChange(event.target.value, event.timeStamp, { version: 1, payload: "home-editor-snapshot" })}
      onKeyDown={(event) => {
        // Mirrors ComposerBehaviorPlugin: plain Enter is always swallowed, and
        // it either submits or reports the refusal.
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          if (canSubmit) onSubmit?.();
          else onSubmitRefused?.();
          return;
        }
        onKeyDown?.(event);
      }}
      disabled={disabled}
    />
  ),
}));

vi.mock("#product/components/workspace/chat/input/ChatComposerActions", () => ({
  ChatComposerActions: ({
    isDisabled,
    disabledReason,
    onSubmit,
  }: {
    isDisabled: boolean;
    disabledReason?: string | null;
    onSubmit: () => void;
  }) => (
    <button
      type="button"
      disabled={isDisabled}
      title={disabledReason ?? undefined}
      aria-label={disabledReason ?? undefined}
      onClick={onSubmit}
      data-chat-send-button
    >
      Submit
    </button>
  ),
}));

function resetHomeNext() {
  screenMocks.productHost.desktop = {};
  screenMocks.homeNext.targetDisabledReason = null;
  screenMocks.homeNext.modelGate = { kind: "launchable" };
  screenMocks.homeNext.isCatalogLoading = false;
  screenMocks.homeNext.hasKnownAgents = true;
  screenMocks.homeNext.retryModelObservation = screenMocks.retryModelObservation;
  screenMocks.homeNext.retryRejected = false;
  screenMocks.homeNext.retryPending = false;
  screenMocks.homeNext.unsupportedHarnessKind = null;
  screenMocks.homeNext.canLaunchTarget = true;
  screenMocks.homeNext.effectiveModelSelection = { kind: "codex", modelId: "gpt-5.4" };
  screenMocks.homeNext.launchTarget = { kind: "cowork" };
  screenMocks.onboardingCards.splice(0);
  screenMocks.homeNextStateArgs = null;
  screenMocks.targetPickerProps = null;
  screenMocks.leadingControlsProps = null;
  screenMocks.trailingControlsProps = null;
}


describe("HomeNextScreen model gate", () => {
  beforeEach(() => {
    installLocalStorageMock();
    resetHomeNext();
    window.localStorage.clear();
    screenMocks.handleHomeAction.mockClear();
    screenMocks.retryModelObservation.mockClear();
    screenMocks.launch.mockClear();
    screenMocks.launch.mockResolvedValue("launched");
  });

  afterEach(() => {
    cleanup();
  });

  it.each([
    [{ kind: "launchable" }],
    [{ kind: "selection_required" }],
    [{ kind: "blocked", reason: "target_missing" }],
    [{ kind: "blocked", reason: "querying" }],
    [{ kind: "blocked", reason: "observation_pending" }],
    [{ kind: "blocked", reason: "observed_empty" }],
  ] as const)("renders no notice for %j", (modelGate) => {
    screenMocks.homeNext.modelGate = modelGate;
    render(<HomeNextScreen />);

    expect(screen.queryByText(/Finish agent setup/i)).toBeNull();
    expect(screen.queryByText(/Couldn't check your models/i)).toBeNull();
    expect(screen.queryByText(/Models couldn't be loaded/i)).toBeNull();
    expect(screen.queryByText(/hasn't reported launch options/i)).toBeNull();
    expect(screen.queryByText(/Models haven't been detected/i)).toBeNull();
    expect(screen.queryByText(/Couldn't refresh your models/i)).toBeNull();
    expect(screen.queryByText(/No agents are supported/i)).toBeNull();
  });

  it("renders setup guidance only for agent_setup_required", () => {
    screenMocks.homeNext.modelGate = { kind: "blocked", reason: "agent_setup_required" };
    render(<HomeNextScreen />);
    expect(screen.getByText("Finish agent setup to start a chat.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Agents" }));
    expect(screenMocks.handleHomeAction)
      .toHaveBeenCalledWith("agent-settings", { harnessKind: null });
    // A string the notice slot CAN emit, so the exclusivity has teeth: an
    // earlier `/configured/i` here matched nothing Home is able to render.
    expect(screen.queryByText(/Models haven't been detected/i)).toBeNull();
    // Ruling 2, at the seam Home actually builds: the notice is on screen, so
    // the picker it is paired with cannot be an enabled "Select model".
    expect(screenMocks.leadingControlsProps.modelSelectorProps.availability)
      .toBe("unavailable");
  });

  it.each([
    [{ kind: "blocked", reason: "observation_failed" }, "Couldn't check your models.", "Retry"],
    [{ kind: "blocked", reason: "transport_error" }, "Models couldn't be loaded.", "Retry"],
    [
      { kind: "blocked", reason: "target_unobserved" },
      "Proliferate Cloud hasn't reported launch options yet.",
      "Check again",
    ],
  ] as const)("renders %j with an enabled cure and no setup CTA", (modelGate, notice, action) => {
    screenMocks.homeNext.modelGate = modelGate;
    render(<HomeNextScreen />);
    expect(screen.getByText(notice)).toBeTruthy();
    expect(screen.queryByText(/Finish agent setup/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Agents" })).toBeNull();

    const cure = screen.getByRole("button", { name: action }) as HTMLButtonElement;
    expect(cure.disabled).toBe(false);
    fireEvent.click(cure);
    expect(screenMocks.retryModelObservation).toHaveBeenCalled();
    expect(screenMocks.handleHomeAction).not.toHaveBeenCalledWith("agent-settings", expect.anything());
  });

  it("labels the disabled Send with the reason while a model is unchosen", () => {
    screenMocks.homeNext.modelGate = { kind: "selection_required" };
    render(<HomeNextScreen />);
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "ship it" } });

    const send = screen.getByRole("button", { name: "Choose a model" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(send.title).toBe("Choose a model");
  });

  it("preserves the draft, moves focus to the picker trigger and re-announces on repeated Enter", () => {
    screenMocks.homeNext.modelGate = { kind: "selection_required" };
    render(<HomeNextScreen />);
    const prompt = screen.getByLabelText("Prompt") as HTMLTextAreaElement;
    fireEvent.change(prompt, { target: { value: "Add retry logic to the sync worker" } });

    const region = document.querySelector("[data-home-model-gate-announcement]") as HTMLElement;
    expect(region.getAttribute("role")).toBe("status");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toBe("");

    fireEvent.keyDown(prompt, { key: "Enter" });

    expect(prompt.value).toBe("Add retry logic to the sync worker");
    expect(screenMocks.launch).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(
      document.querySelector("[data-composer-model-trigger]"),
    );
    const first = region.textContent ?? "";
    expect(first.trim()).toBe("Choose a model before sending");

    fireEvent.keyDown(prompt, { key: "Enter" });
    const second = region.textContent ?? "";
    // Re-committed, not stacked, and never a numeral.
    expect(second).not.toBe(first);
    expect(second.trim()).toBe("Choose a model before sending");
    expect(/\d/.test(second)).toBe(false);
    expect(prompt.value).toBe("Add retry logic to the sync worker");
  });

  it("clears the refusal sentence once a model can be launched", () => {
    screenMocks.homeNext.modelGate = { kind: "selection_required" };
    const view = render(<HomeNextScreen />);
    const prompt = screen.getByLabelText("Prompt") as HTMLTextAreaElement;
    fireEvent.change(prompt, { target: { value: "ship it" } });
    fireEvent.keyDown(prompt, { key: "Enter" });

    const region = document.querySelector("[data-home-model-gate-announcement]") as HTMLElement;
    expect((region.textContent ?? "").trim()).toBe("Choose a model before sending");

    // A sentence that stays in the accessibility tree after the reason is gone
    // is read out on every subsequent visit to the region.
    screenMocks.homeNext.modelGate = { kind: "launchable" };
    view.rerender(<HomeNextScreen />);
    expect(document.querySelector("[data-home-model-gate-announcement]")?.textContent).toBe("");
  });

  it("does not refuse an EMPTY composer out of the editor", () => {
    // Home autofocuses the composer, so Enter before typing is a real first
    // keystroke. It did nothing before this slice and must keep doing nothing:
    // parking the caret on a button turns the next keypress into a menu.
    screenMocks.homeNext.modelGate = { kind: "selection_required" };
    render(<HomeNextScreen />);
    const prompt = screen.getByLabelText("Prompt") as HTMLTextAreaElement;
    prompt.focus();
    fireEvent.keyDown(prompt, { key: "Enter" });

    expect(document.activeElement).toBe(prompt);
    expect(document.querySelector("[data-home-model-gate-announcement]")?.textContent).toBe("");
    // The Send button is disabled because it is EMPTY, so it must not claim
    // the unchosen model is the reason — this string is its accessible name.
    expect(screen.queryByRole("button", { name: "Choose a model" })).toBeNull();
    expect(screen.getByRole("button", { name: "Submit" })).toBeTruthy();
  });

  it("does not announce an unchoosable model or focus a disabled trigger", () => {
    // agent_setup_required has no model to choose and a DISABLED trigger, so
    // "Choose a model before sending" would be false and `focus()` a no-op.
    // The state's own notice is already on screen and says the true thing.
    screenMocks.homeNext.modelGate = { kind: "blocked", reason: "agent_setup_required" };
    screenMocks.homeNext.hasKnownAgents = true;
    render(<HomeNextScreen />);
    const prompt = screen.getByLabelText("Prompt") as HTMLTextAreaElement;
    fireEvent.change(prompt, { target: { value: "ship it" } });
    prompt.focus();

    const trigger = document.querySelector(
      "[data-composer-model-trigger]",
    ) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);

    fireEvent.keyDown(prompt, { key: "Enter" });

    expect(document.activeElement).toBe(prompt);
    expect(document.querySelector("[data-home-model-gate-announcement]")?.textContent).toBe("");
    expect(screen.getByText("Finish agent setup to start a chat.")).toBeTruthy();
    expect(screenMocks.launch).not.toHaveBeenCalled();
  });

  it("renders observation_idle with an honest sentence and an enabled Refresh", () => {
    screenMocks.homeNext.modelGate = { kind: "blocked", reason: "observation_idle" };
    render(<HomeNextScreen />);
    expect(screen.getByText("Models haven't been detected yet.")).toBeTruthy();
    // The state must not be dressed as in-flight. Asserted on the prop the
    // trigger actually reads: no Home path emits the string "Probing", so a
    // `queryByText(/Probing/i)` here could never have failed.
    expect(screenMocks.leadingControlsProps.modelSelectorProps.availability)
      .not.toBe("observation_pending");
    expect(screen.queryByText(/Finish agent setup/i)).toBeNull();
    const cure = screen.getByRole("button", { name: "Refresh" }) as HTMLButtonElement;
    expect(cure.disabled).toBe(false);
    fireEvent.click(cure);
    // That this dispatches a real probe rather than a re-read is asserted in
    // use-home-next-model-selection.test.tsx; here it is the wiring.
    expect(screenMocks.retryModelObservation).toHaveBeenCalled();
  });

  it("says the refresh was refused rather than re-rendering the same sentence", () => {
    // A rejected probe writes no durable state, so the gate cannot move: the
    // button would otherwise appear to do nothing, forever.
    screenMocks.homeNext.modelGate = { kind: "blocked", reason: "observation_idle" };
    screenMocks.homeNext.retryRejected = true;
    render(<HomeNextScreen />);
    expect(screen.getByText("Couldn't refresh your models.")).toBeTruthy();
    expect(screen.queryByText("Models haven't been detected yet.")).toBeNull();
    // Still curable: the action survives the rejection.
    expect((screen.getByRole("button", { name: "Refresh" }) as HTMLButtonElement).disabled)
      .toBe(false);
  });

  it("does not blame a refused refresh for a notice that never fires a probe", () => {
    screenMocks.homeNext.modelGate = { kind: "blocked", reason: "agent_setup_required" };
    screenMocks.homeNext.retryRejected = true;
    render(<HomeNextScreen />);
    expect(screen.getByText("Finish agent setup to start a chat.")).toBeTruthy();
    expect(screen.queryByText("Couldn't refresh your models.")).toBeNull();
  });

  it("keeps the sentence that says a probe RAN and failed", () => {
    // "Couldn't check your models." carries strictly more than a refusal does.
    screenMocks.homeNext.modelGate = { kind: "blocked", reason: "observation_failed" };
    screenMocks.homeNext.retryRejected = true;
    render(<HomeNextScreen />);
    expect(screen.getByText("Couldn't check your models.")).toBeTruthy();
    expect(screen.queryByText("Couldn't refresh your models.")).toBeNull();
  });

  it("says a refresh is running rather than that nothing was detected", () => {
    // Serialized probes, up to 45s per kind, and no polling of a settled row:
    // the terminal sentence would otherwise sit over live work.
    screenMocks.homeNext.modelGate = { kind: "blocked", reason: "observation_idle" };
    screenMocks.homeNext.retryPending = true;
    screenMocks.homeNext.retryRejected = true;
    render(<HomeNextScreen />);
    expect(screen.getByText("Refreshing your models…")).toBeTruthy();
    expect(screen.queryByText("Models haven't been detected yet.")).toBeNull();
    expect(screen.queryByText("Couldn't refresh your models.")).toBeNull();
  });

  it("navigates rather than probing when no agent can ever run here", () => {
    // The only gate with no cure. A Refresh would re-read an identical
    // built-in registry forever, so the action is navigation to the pane that
    // shows WHICH agents are unsupported — never repair vocabulary, and never
    // a probe.
    screenMocks.homeNext.modelGate = { kind: "blocked", reason: "agents_unsupported" };
    screenMocks.homeNext.unsupportedHarnessKind = "cursor";
    render(<HomeNextScreen />);
    expect(screen.getByText("No agents are supported on this machine.")).toBeTruthy();
    for (const name of ["Refresh", "Retry", "Check again"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    fireEvent.click(screen.getByRole("button", { name: "See agents" }));
    // Routed to the harness that IS unsupported. Sending every caller to the
    // Claude pane made the ruling false whenever Claude was not the
    // unsupported one: that pane just says it has not reported.
    expect(screenMocks.handleHomeAction)
      .toHaveBeenCalledWith("agent-settings", { harnessKind: "cursor" });
    expect(screenMocks.retryModelObservation).not.toHaveBeenCalled();
  });

  it("never hands the unsupported harness to the setup notice", () => {
    // Both gates share the `agent_settings` action but mean different agents:
    // one Cursor that can never run, one Claude that needs a login. Routing
    // setup to the unsupported pane opens something that cannot be set up.
    screenMocks.homeNext.modelGate = { kind: "blocked", reason: "agent_setup_required" };
    screenMocks.homeNext.unsupportedHarnessKind = null;
    render(<HomeNextScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Agents" }));
    expect(screenMocks.handleHomeAction)
      .toHaveBeenCalledWith("agent-settings", { harnessKind: null });
  });

  it("keeps the notice action pressable while its own probe is running", () => {
    // A refresh has no guaranteed exit, so disabling the control here removes
    // the only affordance the state has and the user is stranded. Overlap is
    // refused inside the hook instead, which cannot strand anyone.
    screenMocks.homeNext.modelGate = { kind: "blocked", reason: "observation_idle" };
    screenMocks.homeNext.retryPending = true;
    render(<HomeNextScreen />);
    const action = screen.getByRole("button", { name: "Refresh" });
    expect(action.hasAttribute("disabled")).toBe(false);
    fireEvent.click(action);
    expect(screenMocks.retryModelObservation).toHaveBeenCalled();
  });
});
