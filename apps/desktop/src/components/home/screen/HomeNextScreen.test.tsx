// @vitest-environment jsdom

import type { ReactNode, TextareaHTMLAttributes } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeNextScreen } from "./HomeNextScreen";
import { HOME_NEXT_TARGET_SELECTION_STORAGE_KEY } from "@/hooks/home/ui/use-home-next-target-selection-state";
import { HOME_CHAT_COMPOSER_INPUT } from "@/config/chat";

const screenMocks = vi.hoisted(() => {
  const handleHomeAction = vi.fn();
  const launch = vi.fn();
  const clearDraftText = vi.fn();
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
    onboardingCards,
    homeNext,
    homeNextStateArgs: null as any,
    targetPickerProps: null as any,
    leadingControlsProps: null as any,
    trailingControlsProps: null as any,
  };
});

vi.mock("react-router-dom", () => ({
  useNavigate: () => screenMocks.navigate,
}));

// The R5 recommended-workflows strip is a self-contained, query-backed sibling
// (its ordering/launch logic is unit-tested in product-domain). This suite
// exercises composer behavior, so stub the strip out.
vi.mock("@/components/workflows/home/WorkflowRecommendedStrip", () => ({
  WorkflowRecommendedStrip: () => null,
}));

vi.mock("@/hooks/home/derived/use-home-next-state", () => ({
  useHomeNextState: (args: any) => {
    screenMocks.homeNextStateArgs = args;
    return screenMocks.homeNext;
  },
}));

vi.mock("@/hooks/home/derived/use-home-next-launch-controls", () => ({
  useHomeNextLaunchControls: () => ({
    controls: [],
    launchControlValues: {},
  }),
}));

vi.mock("@/hooks/home/workflows/use-home-next-launch", () => ({
  useHomeNextLaunch: () => ({
    isLaunching: false,
    launch: screenMocks.launch,
  }),
}));

vi.mock("@/hooks/home/facade/use-home-screen", () => ({
  useHomeScreen: () => ({
    onboardingCards: screenMocks.onboardingCards,
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

vi.mock("@/components/home/screen/HomeTargetPicker", () => ({
  HomeTargetPicker: (props: any) => {
    screenMocks.targetPickerProps = props;
    return (
      <div data-testid="target-picker">
        <button type="button" onClick={() => props.onSelectCowork()}>
          Mock cowork
        </button>
        <button type="button" onClick={() => props.onSelectRepository("/repo-b")}>
          Mock repo
        </button>
        <button type="button" onClick={() => props.onSelectRuntime("local")}>
          Mock local
        </button>
        <button type="button" onClick={() => props.onSelectRuntime("ssh", "ssh-target-1")}>
          Mock ssh
        </button>
        <button type="button" onClick={() => props.onSelectBranch("feature/sticky")}>
          Mock branch
        </button>
      </div>
    );
  },
}));

vi.mock("@/components/workspace/chat/input/ChatInputControlRow", () => ({
  ComposerLeadingControls: (props: any) => {
    screenMocks.leadingControlsProps = props;
    return <div data-testid="composer-leading-controls" />;
  },
  ComposerTrailingControls: (props: any) => {
    screenMocks.trailingControlsProps = props;
    return <div data-testid="composer-trailing-controls" />;
  },
}));

vi.mock("@proliferate/product-ui/chat/composer/ChatComposerSurface", () => ({
  ChatComposerSurface: ({ children }: { children: ReactNode }) => (
    <div data-testid="composer-surface">{children}</div>
  ),
}));

vi.mock("@proliferate/ui/primitives/ComposerTextarea", () => ({
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

function installLocalStorageMock(options?: { throwOnSet?: boolean }) {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      get length() { return values.size; },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => Array.from(values.keys())[index] ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => {
        if (options?.throwOnSet) throw new Error("localStorage write failed");
        values.set(key, String(value));
      },
    },
  });
}

function resetHomeNext() {
  screenMocks.homeNext.targetDisabledReason = null;
  screenMocks.homeNext.modelAvailabilityState = "launchable";
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

function submitPrompt(text: string): HTMLTextAreaElement {
  render(<HomeNextScreen />);
  const prompt = screen.getByLabelText("Prompt") as HTMLTextAreaElement;
  fireEvent.change(prompt, { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  return prompt;
}

describe("HomeNextScreen model availability notices", () => {
  beforeEach(() => {
    installLocalStorageMock();
    resetHomeNext();
    window.localStorage.clear();
    screenMocks.handleHomeAction.mockClear();
    screenMocks.launch.mockClear();
    screenMocks.launch.mockResolvedValue(true);
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

  it("caps the home composer using the scaled textarea line-height", () => {
    render(<HomeNextScreen />);

    const textarea = screen.getByLabelText("Prompt") as HTMLTextAreaElement;
    // jsdom does not collapse var() calcs, so assert the literal calc string
    // that ties the cap to the --text-composer--line-height scale token.
    const expectedMaxHeight =
      `calc(var(--text-composer--line-height) * ${HOME_CHAT_COMPOSER_INPUT.maxRows})`;

    expect(textarea.style.maxHeight).toBe(expectedMaxHeight);
    expect(textarea.parentElement?.style.maxHeight).toBe(expectedMaxHeight);
  });

  it("still renders target-specific disabled reasons after typing", () => {
    screenMocks.homeNext.targetDisabledReason = "Choose a repository";
    screenMocks.homeNext.canLaunchTarget = false;
    render(<HomeNextScreen />);

    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "hello" } });

    expect(screen.getByText("Choose a repository")).toBeTruthy();
  });

  it("hands cowork prompts directly to launch without rendering a Home preview", () => {
    submitPrompt("start cowork");

    expect(screenMocks.launch).toHaveBeenCalledWith(expect.objectContaining({
      text: "start cowork",
      target: { kind: "cowork" },
    }));
    expect(document.querySelector("[data-home-submit-preview]")).toBeNull();
  });

  it("clears and hands a repository prompt off exactly once without waiting for a paint", async () => {
    let resolveLaunch!: (succeeded: boolean) => void;
    screenMocks.launch.mockReturnValue(new Promise<boolean>((resolve) => {
      resolveLaunch = resolve;
    }));
    screenMocks.homeNext.launchTarget = {
      kind: "worktree",
      repoRootId: "repo-root-1",
      sourceWorkspaceId: null,
      baseBranch: "main",
      defaultBranch: "main",
    };
    const prompt = submitPrompt("start worktree");
    fireEvent.submit(prompt.closest("form")!);

    expect(prompt.value).toBe("");
    expect(screenMocks.launch).toHaveBeenCalledTimes(1);
    expect(screenMocks.launch).toHaveBeenCalledWith(expect.objectContaining({
      text: "start worktree",
      target: expect.objectContaining({ kind: "worktree" }),
    }));
    expect(document.querySelector("[data-home-submit-preview]")).toBeNull();

    resolveLaunch(true);
    await waitFor(() => {
      expect(screenMocks.launch).toHaveBeenCalledTimes(1);
    });
  });

  it.each([
    { label: "returns false", fail: () => screenMocks.launch.mockResolvedValue(false) },
    {
      label: "rejects",
      fail: () => screenMocks.launch.mockRejectedValue(new Error("unexpected launch failure")),
    },
  ])("restores the submitted draft when launch $label", async ({ fail }) => {
    fail();
    const prompt = submitPrompt("keep this draft");
    await waitFor(() => expect(prompt.value).toBe("keep this draft"));
    expect(document.querySelector("[data-home-submit-preview]")).toBeNull();
  });

  it("preserves a newer draft when the submitted launch fails", async () => {
    let resolveLaunch!: (succeeded: boolean) => void;
    screenMocks.launch.mockReturnValue(new Promise<boolean>((resolve) => {
      resolveLaunch = resolve;
    }));
    const prompt = submitPrompt("launch this");
    fireEvent.change(prompt, { target: { value: "newer draft" } });
    await act(async () => {
      resolveLaunch(false);
    });
    expect(prompt.value).toBe("newer draft");
    expect(document.querySelector("[data-home-submit-preview]")).toBeNull();
  });

  it("renders onboarding cards as the only home onboarding actions", () => {
    screenMocks.onboardingCards.push(
      { id: "add-repository", title: "Add a GitHub repo", icon: "github" },
      { id: "agent-defaults", title: "Configure default harnesses", icon: "sliders" },
    );

    render(<HomeNextScreen />);

    expect(screen.getByText("Add a GitHub repo")).toBeTruthy();
    expect(screen.getByText("Configure default harnesses")).toBeTruthy();
    expect(screen.queryByText("Manage agents")).toBeNull();
    expect(screen.queryByText("Add another repository")).toBeNull();
    expect(screen.queryByText(/Choose a local GitHub clone/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add a GitHub repo" }));
    expect(screenMocks.handleHomeAction).toHaveBeenCalledWith("add-repository");

    fireEvent.click(screen.getByRole("button", { name: "Configure default harnesses" }));
    expect(screenMocks.handleHomeAction).toHaveBeenCalledWith("agent-defaults");
  });
});

describe("HomeNextScreen composer control-row parity", () => {
  beforeEach(() => {
    installLocalStorageMock();
    resetHomeNext();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the shared leading and trailing composer control clusters", () => {
    render(<HomeNextScreen />);

    expect(screen.getByTestId("composer-leading-controls")).toBeTruthy();
    expect(screen.getByTestId("composer-trailing-controls")).toBeTruthy();
  });

  it("feeds the clusters sessionless chat-equivalent props", () => {
    render(<HomeNextScreen />);

    expect(screenMocks.leadingControlsProps).toMatchObject({
      runtimeControlsDisabled: false,
      agentKind: "codex",
      activeSessionId: null,
    });
    expect(screenMocks.leadingControlsProps.modelSelectorProps).toMatchObject({
      connectionState: "healthy",
      hasAgents: false,
      isLoading: false,
    });
    expect(screenMocks.trailingControlsProps).toMatchObject({
      runtimeControlsDisabled: false,
      agentKind: "codex",
      activeSessionId: null,
      isEditingQueuedPrompt: false,
      chatDisabled: false,
      isSubmitting: false,
      // Home has no attachments infra pre-session; the shared cluster shows
      // chat's exact pre-session disabled state for these.
      supportsAttachments: false,
      canAttachFiles: false,
    });
  });
});

describe("HomeNextScreen target selection persistence", () => {
  beforeEach(() => {
    installLocalStorageMock();
    resetHomeNext();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("hydrates the last selected launch target into home next state", () => {
    window.localStorage.setItem(HOME_NEXT_TARGET_SELECTION_STORAGE_KEY, JSON.stringify({
      destination: "repository",
      repositorySelection: { kind: "repository", sourceRoot: "/repo-a" },
      repoLaunchKind: "ssh",
      selectedSshTargetId: "ssh-target-1",
      baseBranchOverride: "feature/sticky",
    }));

    render(<HomeNextScreen />);

    expect(screenMocks.homeNextStateArgs).toMatchObject({
      destination: "repository",
      repositorySelection: { kind: "repository", sourceRoot: "/repo-a" },
      repoLaunchKind: "ssh",
      selectedSshTargetId: "ssh-target-1",
      baseBranchOverride: "feature/sticky",
    });
  });

  it("persists repository, branch, and runtime choices from the target picker", () => {
    render(<HomeNextScreen />);

    fireEvent.click(screen.getByRole("button", { name: "Mock repo" }));
    fireEvent.click(screen.getByRole("button", { name: "Mock branch" }));
    fireEvent.click(screen.getByRole("button", { name: "Mock ssh" }));

    expect(JSON.parse(window.localStorage.getItem(HOME_NEXT_TARGET_SELECTION_STORAGE_KEY)!))
      .toMatchObject({
        destination: "repository",
        repositorySelection: { kind: "repository", sourceRoot: "/repo-b" },
        repoLaunchKind: "ssh",
        selectedSshTargetId: "ssh-target-1",
        baseBranchOverride: "feature/sticky",
      });
  });

  it("keeps the selected branch when switching to a local runtime", () => {
    window.localStorage.setItem(HOME_NEXT_TARGET_SELECTION_STORAGE_KEY, JSON.stringify({
      destination: "repository",
      repositorySelection: { kind: "repository", sourceRoot: "/repo-a" },
      repoLaunchKind: "worktree",
      selectedSshTargetId: null,
      baseBranchOverride: "feature/sticky",
    }));
    render(<HomeNextScreen />);

    fireEvent.click(screen.getByRole("button", { name: "Mock local" }));

    expect(JSON.parse(window.localStorage.getItem(HOME_NEXT_TARGET_SELECTION_STORAGE_KEY)!))
      .toMatchObject({
        destination: "repository",
        repositorySelection: { kind: "repository", sourceRoot: "/repo-a" },
        repoLaunchKind: "local",
        baseBranchOverride: "feature/sticky",
      });
  });

  it("keeps target selection in memory when localStorage writes fail", () => {
    installLocalStorageMock({ throwOnSet: true });
    resetHomeNext();
    render(<HomeNextScreen />);

    fireEvent.click(screen.getByRole("button", { name: "Mock repo" }));

    expect(screenMocks.homeNextStateArgs).toMatchObject({
      destination: "repository",
      repositorySelection: { kind: "repository", sourceRoot: "/repo-b" },
    });
    expect(window.localStorage.getItem(HOME_NEXT_TARGET_SELECTION_STORAGE_KEY)).toBeNull();
  });
});
