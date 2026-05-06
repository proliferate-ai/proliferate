// @vitest-environment jsdom

import type { ReactNode, TextareaHTMLAttributes } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeNextScreen } from "./HomeNextScreen";

const screenMocks = vi.hoisted(() => {
  const handleHomeAction = vi.fn();
  const launch = vi.fn();
  const clearDraftText = vi.fn();
  const navigate = vi.fn();
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
    modelAvailabilityState: "launchable",
    canLaunchTarget: true,
    effectiveModelSelection: { kind: "codex", modelId: "gpt-5.4" },
    launchTarget: { kind: "cowork" },
  } as any;

  return {
    handleHomeAction,
    launch,
    clearDraftText,
    navigate,
    homeNext,
  };
});

vi.mock("react-router-dom", () => ({
  useNavigate: () => screenMocks.navigate,
}));

vi.mock("@/hooks/home/use-home-next-state", () => ({
  useHomeNextState: () => screenMocks.homeNext,
}));

vi.mock("@/hooks/home/use-home-next-launch", () => ({
  useHomeNextLaunch: () => ({
    isLaunching: false,
    launch: screenMocks.launch,
  }),
}));

vi.mock("@/hooks/home/use-home-screen", () => ({
  useHomeScreen: () => ({
    actionCards: [],
    isAddingRepo: false,
    handleHomeAction: screenMocks.handleHomeAction,
  }),
}));

vi.mock("@/stores/home/home-draft-handoff-store", () => ({
  useHomeDraftHandoffStore: (selector: (state: {
    draftText: string | null;
    clearDraftText: () => void;
  }) => unknown) => selector({
    draftText: null,
    clearDraftText: screenMocks.clearDraftText,
  }),
}));

vi.mock("@/components/home/HomeTargetPicker", () => ({
  HomeTargetPicker: () => <div data-testid="target-picker" />,
}));

vi.mock("@/components/home/HomeModelPicker", () => ({
  HomeModelPicker: () => <div data-testid="model-picker" />,
}));

vi.mock("@/components/home/HomeModePicker", () => ({
  HomeModePicker: () => <div data-testid="mode-picker" />,
}));

vi.mock("@/components/workspace/chat/input/ChatComposerSurface", () => ({
  ChatComposerSurface: ({ children }: { children: ReactNode }) => (
    <div data-testid="composer-surface">{children}</div>
  ),
}));

vi.mock("@/components/workspace/chat/input/ComposerTextarea", () => ({
  ComposerTextarea: (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
    <textarea aria-label="Prompt" {...props} />
  ),
}));

vi.mock("@/components/workspace/chat/input/ChatComposerActions", () => ({
  ChatComposerActions: ({
    isDisabled,
    onSubmit,
  }: {
    isDisabled: boolean;
    onSubmit: () => void;
  }) => (
    <button type="button" disabled={isDisabled} onClick={onSubmit}>
      Submit
    </button>
  ),
}));

vi.mock("@/components/workspace/chat/transcript/UserMessage", () => ({
  UserMessage: ({ content }: { content: string }) => (
    <div data-chat-user-message>{content}</div>
  ),
}));

function resetHomeNext() {
  screenMocks.homeNext.targetDisabledReason = null;
  screenMocks.homeNext.modelAvailabilityState = "launchable";
  screenMocks.homeNext.canLaunchTarget = true;
  screenMocks.homeNext.effectiveModelSelection = { kind: "codex", modelId: "gpt-5.4" };
  screenMocks.homeNext.launchTarget = { kind: "cowork" };
}

describe("HomeNextScreen model availability notices", () => {
  beforeEach(() => {
    resetHomeNext();
    screenMocks.handleHomeAction.mockClear();
    screenMocks.launch.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders no agent/model notice for launchable and loading states", () => {
    const { rerender } = render(<HomeNextScreen />);

    expect(screen.queryByText(/Finish agent setup/i)).toBeNull();
    expect(screen.queryByText(/Models are unavailable/i)).toBeNull();

    screenMocks.homeNext.modelAvailabilityState = "loading";
    rerender(<HomeNextScreen />);

    expect(screen.queryByText(/Finish agent setup/i)).toBeNull();
    expect(screen.queryByText(/Models are unavailable/i)).toBeNull();
  });

  it("renders setup guidance only for no launchable model", () => {
    screenMocks.homeNext.modelAvailabilityState = "no_launchable_model";

    render(<HomeNextScreen />);

    expect(screen.getByText("Finish agent setup to start a chat.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Agents" }));
    expect(screenMocks.handleHomeAction).toHaveBeenCalledWith("agent-settings");
    expect(screen.queryByText(/configured/i)).toBeNull();
  });

  it("renders neutral load-error copy with no setup CTA", () => {
    screenMocks.homeNext.modelAvailabilityState = "load_error";

    render(<HomeNextScreen />);

    expect(screen.getByText("Models are unavailable right now. Try again in a moment.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Agents" })).toBeNull();
  });

  it("does not render model-derived submit-disabled reasons after typing", () => {
    screenMocks.homeNext.modelAvailabilityState = "no_launchable_model";
    render(<HomeNextScreen />);

    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "hello" } });

    expect(screen.queryByText("No ready models")).toBeNull();
    expect(screen.queryByText("Loading models")).toBeNull();
    expect(screen.queryByText("Couldn't load models")).toBeNull();
  });

  it("still renders target-specific disabled reasons after typing", () => {
    screenMocks.homeNext.targetDisabledReason = "Choose a repository";
    screenMocks.homeNext.canLaunchTarget = false;
    render(<HomeNextScreen />);

    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "hello" } });

    expect(screen.getByText("Choose a repository")).toBeTruthy();
  });
});
