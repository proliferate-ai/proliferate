// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeNextScreen } from "#product/components/home/screen/HomeNextScreen";
import { installLocalStorageMock } from "#product/components/home/screen/HomeNextScreen.test-support";
import { HOME_SUGGESTION_PROMPTS } from "#product/copy/home/home-screen-copy";
import { resetHomeNextTargetSelectionForTests } from "#product/hooks/home/ui/use-home-next-target-selection-state";

let originalRangeRectDescriptor: PropertyDescriptor | undefined;

const suggestionMocks = vi.hoisted(() => {
  const launch = vi.fn();
  const onboardingCards: any[] = [];
  const homeNext = {
    selectedRepository: null,
    repositories: [],
    selectedBranchName: null,
    branchOptions: [],
    branchQuery: { isLoading: false, isError: false },
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
    homeNext,
    launch,
    onboardingCards,
    homeNextStateArgs: null as any,
    launchControlsArgs: null as any,
  };
});

vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({ desktop: {} }),
}));

vi.mock("#product/hooks/home/derived/use-home-next-state", () => ({
  useHomeNextState: (args: any) => {
    suggestionMocks.homeNextStateArgs = args;
    return suggestionMocks.homeNext;
  },
}));

vi.mock("#product/hooks/home/derived/use-home-next-launch-controls", () => ({
  useHomeNextLaunchControls: (args: any) => {
    suggestionMocks.launchControlsArgs = args;
    return { controls: [], launchControlValues: args.controlOverrides };
  },
}));

vi.mock("#product/hooks/home/derived/use-home-available-slash-commands", () => ({
  useHomeAvailableSlashCommands: () => [],
}));

vi.mock("#product/hooks/home/workflows/use-home-next-launch", () => ({
  useHomeNextLaunch: () => ({ isLaunching: false, launch: suggestionMocks.launch }),
}));

vi.mock("#product/hooks/home/facade/use-home-screen", () => ({
  useHomeScreen: () => ({
    onboardingCards: suggestionMocks.onboardingCards,
    authSetupStep: "hidden",
    authSetupEvidence: null,
    repositoriesLoading: false,
    agentsLoading: false,
    isReconciling: false,
    cloudRepoConfigsLoading: false,
    cloudSignInChecking: false,
    cloudActive: false,
    adoptedHarnessKinds: null,
    modelProbeDismissalState: "dismissed",
    modelProbeInputs: {
      dismissed: true,
      agentsLoading: false,
      isReconciling: false,
      harnessKinds: [],
    },
    isAddingRepo: false,
    handleHomeAction: vi.fn(),
    dismissModelProbeCard: vi.fn(),
  }),
}));

vi.mock("#product/stores/home/home-draft-handoff-store", () => ({
  useHomeDraftHandoffStore: (selector: (state: {
    draftText: string | null;
    clearDraftText: () => void;
  }) => unknown) => selector({ draftText: null, clearDraftText: vi.fn() }),
}));

vi.mock("#product/components/home/screen/HomeTargetPicker", () => ({
  HomeTargetPicker: () => <div data-testid="target-picker" />,
}));

vi.mock("#product/components/workspace/chat/input/ChatInputControlRow", () => ({
  ComposerLeadingControls: ({ modelSelectorProps }: any) => (
    <>
      <button
        type="button"
        onClick={() => modelSelectorProps.onSelect({ kind: "claude", modelId: "claude-sonnet" })}
      >
        Choose fixture model
      </button>
      <button
        type="button"
        onClick={() => suggestionMocks.launchControlsArgs.onSelectControl("effort", "high")}
      >
        Choose fixture config
      </button>
    </>
  ),
  ComposerTrailingControls: () => <div data-testid="trailing-controls" />,
}));

vi.mock("#product/components/workspace/chat/composer/ChatComposerSurface", () => ({
  ChatComposerSurface: ({ children }: { children: ReactNode }) => (
    <div data-testid="composer-surface">{children}</div>
  ),
}));

vi.mock("#product/components/workspace/chat/content/PromptContentRenderer", () => ({
  DraftAttachmentPreviewList: ({ attachments }: any) => (
    <div>{attachments.map((attachment: any) => (
      <span key={attachment.id}>{`attachment:${attachment.name}`}</span>
    ))}</div>
  ),
}));

vi.mock("#product/components/workspace/chat/input/ChatComposerActions", () => ({
  ChatComposerActions: ({ isDisabled, onSubmit }: any) => (
    <button type="button" disabled={isDisabled} onClick={onSubmit}>Submit</button>
  ),
}));

function editorRoot(): HTMLElement {
  const editor = document.querySelector<HTMLElement>("[data-home-composer-editor]");
  expect(editor).not.toBeNull();
  return editor!;
}

function selectionOffsetWithin(root: HTMLElement): number {
  const selection = window.getSelection();
  expect(selection?.isCollapsed).toBe(true);
  expect(selection?.anchorNode).not.toBeNull();
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(selection!.anchorNode!, selection!.anchorOffset);
  return range.toString().length;
}

function moveDomCaret(root: HTMLElement, offset: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let textNode = walker.nextNode();
  while (textNode && (textNode.textContent?.length ?? 0) < offset) {
    textNode = walker.nextNode();
  }
  expect(textNode).not.toBeNull();
  const range = document.createRange();
  range.setStart(textNode!, offset);
  range.collapse(true);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  fireEvent(document, new Event("selectionchange"));
}

function pasteText(root: HTMLElement, text: string) {
  const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      files: [],
      types: ["text/plain"],
      getData: (type: string) => type === "text/plain" ? text : "",
    },
  });
  fireEvent(root, event);
}

describe("HomeNextScreen suggestions", () => {
  beforeEach(() => {
    installLocalStorageMock();
    resetHomeNextTargetSelectionForTests();
    suggestionMocks.onboardingCards.splice(0);
    suggestionMocks.homeNextStateArgs = null;
    suggestionMocks.launchControlsArgs = null;
    suggestionMocks.launch.mockReset();
    URL.createObjectURL = vi.fn(() => "blob:home-suggestion-attachment");
    URL.revokeObjectURL = vi.fn();
    vi.stubGlobal("ResizeObserver", class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    vi.stubGlobal("ClipboardEvent", class ClipboardEvent extends Event {});
    vi.stubGlobal("DragEvent", class DragEvent extends Event {});
    originalRangeRectDescriptor = Object.getOwnPropertyDescriptor(
      Range.prototype,
      "getBoundingClientRect",
    );
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0,
        toJSON: () => ({}),
      }),
    });
    vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    if (originalRangeRectDescriptor) {
      Object.defineProperty(
        Range.prototype,
        "getBoundingClientRect",
        originalRangeRectDescriptor,
      );
    } else {
      Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders the settled slot and replaces the real editor draft from every activation path", async () => {
    const user = userEvent.setup();
    const view = render(<HomeNextScreen />);
    const region = document.querySelector<HTMLElement>("[data-home-suggestions-region]")!;
    expect(region).not.toBeNull();
    expect(document.querySelector("[data-home-onboarding-region]")).toBeNull();
    expect(within(region).getAllByRole("button").map((button) => button.getAttribute("aria-label")))
      .toEqual(HOME_SUGGESTION_PROMPTS);

    const editor = editorRoot();
    await user.click(editor);
    pasteText(editor, "replace this draft");
    await waitFor(() => expect(editor.textContent).toBe("replace this draft"));

    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(fileInput, {
      target: { files: [new File(["notes"], "notes.txt", { type: "text/plain" })] },
    });
    expect(screen.getByText("attachment:notes.txt")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Choose fixture model" }));
    expect(suggestionMocks.homeNextStateArgs.modelSelectionOverride).toEqual({
      kind: "claude",
      modelId: "claude-sonnet",
    });
    await user.click(screen.getByRole("button", { name: "Choose fixture config" }));
    expect(suggestionMocks.launchControlsArgs.controlOverrides).toEqual({ effort: "high" });

    await user.click(screen.getByRole("button", { name: HOME_SUGGESTION_PROMPTS[0] }));
    await waitFor(() => expect(editor.textContent).toBe(HOME_SUGGESTION_PROMPTS[0]));
    expect(document.activeElement).toBe(editor);
    expect(selectionOffsetWithin(editor)).toBe(HOME_SUGGESTION_PROMPTS[0].length);

    screen.getByRole("button", { name: HOME_SUGGESTION_PROMPTS[1] }).focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(editor.textContent).toBe(HOME_SUGGESTION_PROMPTS[1]));
    expect(document.activeElement).toBe(editor);
    expect(selectionOffsetWithin(editor)).toBe(HOME_SUGGESTION_PROMPTS[1].length);

    screen.getByRole("button", { name: HOME_SUGGESTION_PROMPTS[2] }).focus();
    await user.keyboard(" ");
    await waitFor(() => expect(editor.textContent).toBe(HOME_SUGGESTION_PROMPTS[2]));
    expect(document.activeElement).toBe(editor);
    expect(selectionOffsetWithin(editor)).toBe(HOME_SUGGESTION_PROMPTS[2].length);

    await user.click(screen.getByRole("button", { name: HOME_SUGGESTION_PROMPTS[0] }));
    await waitFor(() => expect(editor.textContent).toBe(HOME_SUGGESTION_PROMPTS[0]));
    moveDomCaret(editor, 2);
    expect(selectionOffsetWithin(editor)).toBe(2);
    await user.click(screen.getByRole("button", { name: HOME_SUGGESTION_PROMPTS[0] }));
    await waitFor(() => expect(selectionOffsetWithin(editor)).toBe(HOME_SUGGESTION_PROMPTS[0].length));
    expect(document.activeElement).toBe(editor);

    expect(screen.getByText("attachment:notes.txt")).toBeTruthy();
    expect(suggestionMocks.homeNextStateArgs.modelSelectionOverride).toEqual({
      kind: "claude",
      modelId: "claude-sonnet",
    });
    expect(suggestionMocks.launchControlsArgs.controlOverrides).toEqual({ effort: "high" });
    expect(suggestionMocks.launch).not.toHaveBeenCalled();

    suggestionMocks.onboardingCards.push({
      id: "add-repository",
      title: "Add a repository",
      description: "Choose a repository to continue.",
      icon: "github",
    });
    view.rerender(<HomeNextScreen />);
    expect(document.querySelector("[data-home-onboarding-region]")).not.toBeNull();
    expect(document.querySelector("[data-home-suggestions-region]")).toBeNull();
  });
});
