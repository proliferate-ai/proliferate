// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeNextScreen } from "#product/components/home/screen/HomeNextScreen";
import { HOME_MODEL_GATE_SEND_BLOCKED_REASON } from "#product/lib/domain/home/home-model-gate";
import {
  HOME_NEXT_TARGET_SELECTION_STORAGE_KEY,
  hydrateHomeNextTargetSelection,
  resetHomeNextTargetSelectionForTests,
  setHomeNextTargetSelectionStorageContext,
} from "#product/hooks/home/ui/use-home-next-target-selection-state";
import { createMemoryProductStorage, type MemoryProductStorage } from "#product/test/product-storage-test-utils";
import type { ProductStorage } from "@proliferate/product-client/host/product-host";
import { CHAT_COLUMN_CLASSNAME, CHAT_SURFACE_GUTTER_CLASSNAME } from "#product/config/chat-layout";
import { HOME_CHAT_COMPOSER_INPUT } from "#product/config/chat";
import { installLocalStorageMock } from "#product/components/home/screen/HomeNextScreen.test-support";

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

vi.mock("react-router-dom", () => ({ useNavigate: () => screenMocks.navigate }));

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

vi.mock("#product/hooks/home/derived/use-home-installation-readiness", () => ({ useHomeInstallationReadiness: () => null })); // own hook now (D-R1/D-R2); covered by use-home-installation-readiness.test.tsx
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
            <button type="button" onClick={() => props.onSelectRuntime("worktree")}>
              Mock worktree
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
    return <div data-testid="composer-leading-controls" />;
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
  ComposerRichTextEditor: ({ value, snapshot, onChange, onKeyDown, disabled }: any) => (
    <textarea aria-label="Prompt" data-editor-snapshot={snapshot?.payload} value={value} onChange={(event) => onChange(event.target.value, event.timeStamp, { version: 1, payload: "home-editor-snapshot" })} onKeyDown={onKeyDown} disabled={disabled} />
  ),
}));
vi.mock("#product/components/workspace/chat/input/ChatComposerActions", () => ({
  // `disabledReason` is the accessible NAME on the real control.
  ChatComposerActions: (props: {
    isDisabled: boolean; disabledReason?: string | null; onSubmit: () => void;
  }) => (
    <button type="button" disabled={props.isDisabled} onClick={props.onSubmit}
      aria-label={props.disabledReason ?? undefined}>
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
  screenMocks.homeNext.canLaunchTarget = true;
  screenMocks.homeNext.effectiveModelSelection = { kind: "codex", modelId: "gpt-5.4" };
  screenMocks.homeNext.launchTarget = { kind: "cowork" };
  screenMocks.onboardingCards.splice(0);
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
    screenMocks.launch.mockResolvedValue("launched");
  });

  afterEach(() => {
    cleanup();
  });

  // Was three queries for deleted ModelAvailabilityState copy no source emits.
  it.each([
    [{ kind: "blocked", reason: "agent_setup_required" }, false],
    [{ kind: "selection_required" }, true],
  ] as const)("names the unchosen model on Send for %j", (modelGate, named) => {
    screenMocks.homeNext.modelGate = modelGate;
    render(<HomeNextScreen />);
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "hello" } });
    const name = HOME_MODEL_GATE_SEND_BLOCKED_REASON;
    expect(screen.queryByRole("button", { name }) !== null).toBe(named);

  });

  it("caps the home composer using the scaled textarea line-height", () => {
    render(<HomeNextScreen />);

    const textarea = screen.getByLabelText("Prompt") as HTMLTextAreaElement;
    // jsdom does not collapse var() calcs, so assert the literal calc string
    // that ties the cap to the --text-composer--line-height scale token.
    const expectedMaxHeight =
      `calc(var(--text-composer--line-height) * ${HOME_CHAT_COMPOSER_INPUT.maxRows})`;

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

    expect(screenMocks.homeNextStateArgs).toMatchObject({ destination: "cowork" });
    expect(screenMocks.targetPickerProps).toMatchObject({ desktopTargetsAvailable: true });
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
    { label: "returns false", fail: () => screenMocks.launch.mockResolvedValue("not-started") },
    {
      label: "rejects",
      fail: () => screenMocks.launch.mockRejectedValue(new Error("unexpected launch failure")),
    },
  ])("restores the submitted draft when launch $label", async ({ fail }) => {
    fail();
    const prompt = submitPrompt("keep this draft");
    await waitFor(() => expect(prompt.value).toBe("keep this draft"));
    expect(prompt.dataset.editorSnapshot).toBe("home-editor-snapshot");
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
    expect(document.querySelector("[data-home-onboarding-region]")).toBeTruthy();
    expect(document.querySelector("[data-home-composer-dock]")).toBeTruthy();

    // Was three negations of literals nothing emits; the live form is the list.
    const cards = document.querySelectorAll("[data-home-onboarding-region] button");
    expect(Array.from(cards).map((card) => card.getAttribute("aria-label"))).toEqual([
      "Add a GitHub repo",
      "Configure default harnesses",
    ]);
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
    const column = screen.getByLabelText("Prompt").closest('[class~="max-w-transcript-thread"]');
    expect(column?.className).toContain("max-w-transcript-thread");
    expect(column?.parentElement?.className).toContain(CHAT_SURFACE_GUTTER_CLASSNAME);
  });

  it("attaches the launch utility bar above the bottom-docked composer", () => {
    render(<HomeNextScreen />);

    const utilityBar = document.querySelector("[data-home-launch-utility-bar]");
    const composer = screen.getByLabelText("Prompt").closest('[data-focus-zone="chat"]');
    expect(utilityBar).not.toBeNull();
    expect(composer).not.toBeNull();
    expect(
      utilityBar!.compareDocumentPosition(composer!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(composer?.closest("[data-home-composer-dock]")).not.toBeNull();
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
      // From the agent CATALOG, not from the group list: an agent that has
      // reported no models yet still exists.
      hasAgents: true,
      isLoading: false,
      availability: "ready",
    });
    expect(screenMocks.trailingControlsProps).toMatchObject({
      runtimeControlsDisabled: false,
      activeSessionId: null,
      isEditingQueuedPrompt: false,
      chatDisabled: false,
      isSubmitting: false,
      // Pre-session attachments run on the home-scoped controller with
      // optimistic capabilities, so the shared cluster's + button is live.
      supportsAttachments: true,
      canAttachFiles: true,
    });
    expect(typeof screenMocks.trailingControlsProps.onAttachFile).toBe("function");
  });
});

describe("HomeNextScreen composer attachments", () => {
  beforeEach(() => {
    installLocalStorageMock();
    resetHomeNext();
    window.localStorage.clear();
    screenMocks.launch.mockClear();
    screenMocks.launch.mockResolvedValue("launched");
    URL.createObjectURL = vi.fn(() => "blob:home-attachment");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  function homeFileInput(): HTMLInputElement {
    const input = document.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    return input as HTMLInputElement;
  }

  it("attaches picked files, sends them with the launch, and clears on success", async () => {
    render(<HomeNextScreen />);

    fireEvent.change(homeFileInput(), {
      target: { files: [new File(["notes"], "notes.txt", { type: "text/plain" })] },
    });
    expect(screen.getByText("attachment:notes.txt")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "use my notes" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(screenMocks.launch).toHaveBeenCalledWith(expect.objectContaining({
      text: "use my notes",
      attachmentSnapshots: [
        expect.objectContaining({ name: "notes.txt", kind: "text_resource" }),
      ],
    }));
    await waitFor(() => {
      expect(screen.queryByText("attachment:notes.txt")).toBeNull();
    });
  });

  it("submits attachment-only launches without any draft text", async () => {
    render(<HomeNextScreen />);

    fireEvent.change(homeFileInput(), {
      target: { files: [new File(["png"], "shot.png", { type: "image/png" })] },
    });
    const submit = screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);

    expect(screenMocks.launch).toHaveBeenCalledWith(expect.objectContaining({
      text: "",
      attachmentSnapshots: [
        expect.objectContaining({ name: "shot.png", kind: "image" }),
      ],
    }));
    await waitFor(() => {
      expect(screen.queryByText("attachment:shot.png")).toBeNull();
    });
  });

  it("keeps attachments alongside the restored draft when launch fails", async () => {
    screenMocks.launch.mockResolvedValue("not-started");
    render(<HomeNextScreen />);

    fireEvent.change(homeFileInput(), {
      target: { files: [new File(["png"], "shot.png", { type: "image/png" })] },
    });
    const prompt = screen.getByLabelText("Prompt") as HTMLTextAreaElement;
    fireEvent.change(prompt, { target: { value: "look at this" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(prompt.value).toBe("look at this"));
    expect(screen.getByText("attachment:shot.png")).toBeTruthy();
  });

  it("attaches files dropped anywhere on the home screen", () => {
    const { container } = render(<HomeNextScreen />);
    const root = container.firstElementChild as HTMLElement;

    fireEvent.drop(root, {
      dataTransfer: {
        types: ["Files"],
        files: [new File(["png"], "drop.png", { type: "image/png" })],
      },
    });

    expect(screen.getByText("attachment:drop.png")).toBeTruthy();
  });

  it("recovers dropped local paths as path references when the target runs on this machine", async () => {
    screenMocks.productHost.desktop = {
      files: {
        getDragPasteboardChangeCount: async () => 7,
        readDroppedPaths: async () => ({
          changeCount: 7,
          entries: [
            { path: "/tmp/big-archive.zip", name: "big-archive.zip", isDirectory: false, size: 33 },
          ],
        }),
      },
    };
    const { container } = render(<HomeNextScreen />);
    const root = container.firstElementChild as HTMLElement;
    const zip = new File(["x".repeat(33)], "big-archive.zip", { type: "application/zip" });

    fireEvent.dragEnter(root, { dataTransfer: { types: ["Files"], files: [] } });
    fireEvent.drop(root, { dataTransfer: { types: ["Files"], files: [zip] } });

    await waitFor(() => {
      expect(screen.getByText("attachment:big-archive.zip")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "inspect the archive" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(screenMocks.launch).toHaveBeenCalledWith(expect.objectContaining({
      attachmentSnapshots: [
        expect.objectContaining({ kind: "local_ref", localPath: "/tmp/big-archive.zip" }),
      ],
    }));
  });

  it("clears draft attachments when the target flips off this machine", () => {
    const { rerender } = render(<HomeNextScreen />);
    fireEvent.change(homeFileInput(), {
      target: { files: [new File(["notes"], "notes.txt", { type: "text/plain" })] },
    });
    expect(screen.getByText("attachment:notes.txt")).toBeTruthy();

    screenMocks.homeNext.launchTarget = {
      kind: "cloud",
      gitOwner: "acme",
      gitRepoName: "app",
      baseBranch: "main",
    };
    rerender(<HomeNextScreen />);

    expect(screen.queryByText("attachment:notes.txt")).toBeNull();
  });

  it("removes an attachment from the draft list", () => {
    render(<HomeNextScreen />);

    fireEvent.change(homeFileInput(), {
      target: { files: [new File(["notes"], "notes.txt", { type: "text/plain" })] },
    });
    fireEvent.click(screen.getByText("attachment:notes.txt"));

    expect(screen.queryByText("attachment:notes.txt")).toBeNull();
  });
});

describe("HomeNextScreen target selection persistence", () => {
  let memory: MemoryProductStorage;

  beforeEach(() => {
    resetHomeNext();
    resetHomeNextTargetSelectionForTests();
    memory = createMemoryProductStorage();
    setHomeNextTargetSelectionStorageContext(memory.context);
  });

  afterEach(() => {
    cleanup();
    resetHomeNextTargetSelectionForTests();
  });

  it("hydrates the last selected launch target into home next state", async () => {
    memory.values.set(HOME_NEXT_TARGET_SELECTION_STORAGE_KEY, {
      destination: "repository",
      repositorySelection: { kind: "repository", sourceRoot: "/repo-a" },
      repoLaunchKind: "worktree",
      baseBranchOverride: "feature/sticky",
    });
    await hydrateHomeNextTargetSelection(memory.context);

    render(<HomeNextScreen />);

    expect(screenMocks.homeNextStateArgs).toMatchObject({
      destination: "repository",
      repositorySelection: { kind: "repository", sourceRoot: "/repo-a" },
      repoLaunchKind: "worktree",
      baseBranchOverride: "feature/sticky",
    });
  });

  it("normalizes the default target to repository Cloud on Web", () => {
    screenMocks.productHost.desktop = null;

    render(<HomeNextScreen />);

    expect(screenMocks.homeNextStateArgs).toMatchObject({
      desktopTargetsAvailable: false,
      destination: "repository",
      repoLaunchKind: "cloud",
    });
    expect(screenMocks.targetPickerProps).toMatchObject({
      desktopTargetsAvailable: false,
      repoLaunchKind: "cloud",
    });
    expect(screen.queryByRole("button", { name: "Mock cowork" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mock local" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mock worktree" })).toBeNull();
  });

  it("normalizes and rejects persisted Desktop targets on Web", async () => {
    screenMocks.productHost.desktop = null;
    memory.values.set(HOME_NEXT_TARGET_SELECTION_STORAGE_KEY, {
      destination: "cowork",
      repositorySelection: { kind: "auto" },
      repoLaunchKind: "worktree",
      baseBranchOverride: null,
    });
    await hydrateHomeNextTargetSelection(memory.context);

    render(<HomeNextScreen />);

    expect(screenMocks.homeNextStateArgs).toMatchObject({
      destination: "repository",
      repoLaunchKind: "cloud",
    });
    await act(async () => {
      screenMocks.targetPickerProps.onSelectCowork();
      screenMocks.targetPickerProps.onSelectRuntime("local");
      screenMocks.targetPickerProps.onSelectRuntime("worktree");
      screenMocks.targetPickerProps.onSelectRepository("/repo-b");
      await Promise.resolve();
    });
    expect(screenMocks.homeNextStateArgs).toMatchObject({
      destination: "repository",
      repositorySelection: { kind: "repository", sourceRoot: "/repo-b" },
      repoLaunchKind: "cloud",
    });
    expect(memory.readJson(HOME_NEXT_TARGET_SELECTION_STORAGE_KEY))
      .toMatchObject({
        destination: "repository",
        repositorySelection: { kind: "repository", sourceRoot: "/repo-b" },
        repoLaunchKind: "cloud",
      });
  });

  it("persists repository, branch, and runtime choices from the target picker", async () => {
    render(<HomeNextScreen />);

    fireEvent.click(screen.getByRole("button", { name: "Mock repo" }));
    fireEvent.click(screen.getByRole("button", { name: "Mock branch" }));
    fireEvent.click(screen.getByRole("button", { name: "Mock worktree" }));
    await Promise.resolve();

    expect(memory.readJson(HOME_NEXT_TARGET_SELECTION_STORAGE_KEY))
      .toMatchObject({
        destination: "repository",
        repositorySelection: { kind: "repository", sourceRoot: "/repo-b" },
        repoLaunchKind: "worktree",
        baseBranchOverride: "feature/sticky",
      });
  });

  it("keeps the selected branch when switching to a local runtime", async () => {
    memory.values.set(HOME_NEXT_TARGET_SELECTION_STORAGE_KEY, {
      destination: "repository",
      repositorySelection: { kind: "repository", sourceRoot: "/repo-a" },
      repoLaunchKind: "worktree",
      baseBranchOverride: "feature/sticky",
    });
    await hydrateHomeNextTargetSelection(memory.context);
    render(<HomeNextScreen />);

    fireEvent.click(screen.getByRole("button", { name: "Mock local" }));
    await Promise.resolve();

    expect(memory.readJson(HOME_NEXT_TARGET_SELECTION_STORAGE_KEY))
      .toMatchObject({
        destination: "repository",
        repositorySelection: { kind: "repository", sourceRoot: "/repo-a" },
        repoLaunchKind: "local",
        baseBranchOverride: "feature/sticky",
      });
  });

  it("keeps target selection in memory when a ProductStorage write fails", async () => {
    const captured: unknown[] = [];
    const throwingStorage: ProductStorage = {
      getItem: async () => null,
      setItem: async () => {
        throw new Error("storage write failed");
      },
      removeItem: async () => {},
    };
    setHomeNextTargetSelectionStorageContext({
      storage: throwingStorage,
      captureException: (error) => captured.push(error),
    });
    render(<HomeNextScreen />);

    fireEvent.click(screen.getByRole("button", { name: "Mock repo" }));
    await Promise.resolve();
    await Promise.resolve();

    // In-memory selection still applied even though the persisted write rejected.
    expect(screenMocks.homeNextStateArgs).toMatchObject({
      destination: "repository",
      repositorySelection: { kind: "repository", sourceRoot: "/repo-b" },
    });
    expect(captured.length).toBeGreaterThan(0);
  });
});
