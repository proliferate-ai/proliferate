// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeNextScreen } from "#product/components/home/screen/HomeNextScreen";
import { installLocalStorageMock } from "#product/components/home/screen/HomeNextScreen.test-support";

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
    sshTargetOptions: [],
    sshTargetsLoading: false,
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
            <button type="button" onClick={() => props.onSelectRuntime("ssh", "ssh-target-1")}>
              Mock ssh
            </button>
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
    // a refused Enter must land on.
    return (
      <div data-testid="composer-leading-controls">
        <button type="button" data-composer-model-trigger>Select model</button>
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
  screenMocks.homeNext.canLaunchTarget = true;
  screenMocks.homeNext.effectiveModelSelection = { kind: "codex", modelId: "gpt-5.4" };
  screenMocks.homeNext.launchTarget = { kind: "cowork" };
  screenMocks.onboardingCards.splice(0);
  screenMocks.homeNext.sshTargetOptions = [];
  screenMocks.homeNext.sshTargetsLoading = false;
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
  });

  it("renders setup guidance only for agent_setup_required", () => {
    screenMocks.homeNext.modelGate = { kind: "blocked", reason: "agent_setup_required" };
    render(<HomeNextScreen />);
    expect(screen.getByText("Finish agent setup to start a chat.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Agents" }));
    expect(screenMocks.handleHomeAction).toHaveBeenCalledWith("agent-settings");
    expect(screen.queryByText(/configured/i)).toBeNull();
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
    expect(screenMocks.handleHomeAction).not.toHaveBeenCalledWith("agent-settings");
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
});
