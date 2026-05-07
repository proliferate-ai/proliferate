import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  CHAT_COMPOSER_INPUT_LINE_HEIGHT_REM,
  HOME_CHAT_COMPOSER_INPUT,
} from "@/config/chat";
import { HomeModePicker } from "@/components/home/screen/HomeModePicker";
import { HomeModelPicker } from "@/components/home/screen/HomeModelPicker";
import { HomeTargetPicker } from "@/components/home/screen/HomeTargetPicker";
import { ChatComposerActions } from "@/components/workspace/chat/input/ChatComposerActions";
import { ChatComposerSurface } from "@/components/workspace/chat/input/ChatComposerSurface";
import { ComposerTextarea } from "@/components/workspace/chat/input/ComposerTextarea";
import { UserMessage } from "@/components/workspace/chat/transcript/UserMessage";
import { Button } from "@/components/ui/Button";
import { useHomeNextLaunch } from "@/hooks/home/use-home-next-launch";
import { useHomeNextState } from "@/hooks/home/use-home-next-state";
import { useHomeScreen } from "@/hooks/home/use-home-screen";
import { useHomeDraftHandoffStore } from "@/stores/home/home-draft-handoff-store";
import {
  type HomeNextDestination,
  type HomeNextModelSelection,
  type HomeNextRepoLaunchKind,
  type HomeNextRepositorySelection,
} from "@/lib/domain/home/home-next-launch";
import type { SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";
import { buildCloudRepoSettingsHref } from "@/lib/domain/settings/navigation";
import { scheduleAfterNextPaint } from "@/lib/infra/schedule-after-next-paint";
import { Clock, Folder, Settings } from "@/components/ui/icons";
import type { HomeActionId } from "@/lib/domain/home/home-screen";

function resolveActionIcon(actionId: HomeActionId) {
  switch (actionId) {
    case "resume-last-workspace":
      return <Clock className="size-3.5" />;
    case "add-repository":
      return <Folder className="size-3.5" />;
    case "agent-settings":
    case "repository-settings":
      return <Settings className="size-3.5" />;
  }
}

function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    scheduleAfterNextPaint(resolve);
  });
}

export function HomeNextScreen() {
  const navigate = useNavigate();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState("");
  const [destination, setDestination] = useState<HomeNextDestination>("cowork");
  const [repositorySelection, setRepositorySelection] =
    useState<HomeNextRepositorySelection>({ kind: "auto" });
  const [repoLaunchKind, setRepoLaunchKind] = useState<HomeNextRepoLaunchKind>("worktree");
  const [modelSelectionOverride, setModelSelectionOverride] =
    useState<HomeNextModelSelection | null>(null);
  const [baseBranchOverride, setBaseBranchOverride] = useState<string | null>(null);
  const [modeOverrideId, setModeOverrideId] = useState<string | null>(null);
  const [targetSearch, setTargetSearch] = useState("");
  const [submittedPreview, setSubmittedPreview] = useState<{
    id: string;
    text: string;
  } | null>(null);
  const restoredDraftText = useHomeDraftHandoffStore((state) => state.draftText);
  const clearRestoredDraftText = useHomeDraftHandoffStore((state) => state.clearDraftText);
  const {
    actionCards,
    isAddingRepo,
    handleHomeAction,
  } = useHomeScreen();
  const homeNext = useHomeNextState({
    destination,
    repositorySelection,
    repoLaunchKind,
    modelSelectionOverride,
    baseBranchOverride,
    modeOverrideId,
  });
  const { isLaunching, launch } = useHomeNextLaunch();

  useEffect(() => {
    if (restoredDraftText !== null) {
      setDraft(restoredDraftText);
      clearRestoredDraftText();
    }
  }, [clearRestoredDraftText, restoredDraftText]);

  const promptTarget = destination === "repository"
    ? homeNext.selectedRepository?.name?.trim()
    : null;
  const heading = promptTarget
    ? `What should we build in ${promptTarget}?`
    : "What should we build?";
  const submitDisabledReason = draft.trim().length === 0
    ? null
    : homeNext.targetDisabledReason;
  const modelAvailabilityNotice =
    homeNext.modelAvailabilityState === "no_launchable_model"
      ? {
        text: "Finish agent setup to start a chat.",
        actionLabel: "Agents",
      }
      : homeNext.modelAvailabilityState === "load_error"
        ? {
          text: "Models are unavailable right now. Try again in a moment.",
          actionLabel: null,
        }
        : null;
  const canSubmit =
    draft.trim().length > 0
    && homeNext.modelAvailabilityState === "launchable"
    && homeNext.canLaunchTarget
    && !!homeNext.effectiveModelSelection
    && !!homeNext.launchTarget
    && submittedPreview === null
    && !isLaunching;
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    const lineHeightPx = parseFloat(getComputedStyle(el).lineHeight);
    if (!Number.isFinite(lineHeightPx) || lineHeightPx <= 0) return;

    const rootFontSizePx = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const homeMinHeightPx = Number.isFinite(rootFontSizePx)
      ? rootFontSizePx * HOME_CHAT_COMPOSER_INPUT.minHeightRem
      : lineHeightPx * HOME_CHAT_COMPOSER_INPUT.minRows;
    const minPx = Math.max(lineHeightPx * HOME_CHAT_COMPOSER_INPUT.minRows, homeMinHeightPx);
    const maxPx = lineHeightPx * HOME_CHAT_COMPOSER_INPUT.maxRows;
    el.style.height = "auto";
    const contentHeight = el.scrollHeight;
    const next = Math.min(maxPx, Math.max(minPx, contentHeight));
    el.style.height = `${next}px`;
    el.style.overflowY = contentHeight > maxPx ? "auto" : "hidden";
  }, [draft]);

  async function handleSubmit() {
    if (!canSubmit || !homeNext.effectiveModelSelection || !homeNext.launchTarget) return;

    const submittedDraft = draft;
    const submittedText = submittedDraft.trim();
    flushSync(() => {
      setSubmittedPreview({
        id: crypto.randomUUID(),
        text: submittedText,
      });
      setDraft("");
    });
    await waitForNextPaint();
    const succeeded = await launch({
      text: submittedDraft,
      modelSelection: homeNext.effectiveModelSelection,
      modeId: homeNext.effectiveModeId,
      target: homeNext.launchTarget,
    });
    if (!succeeded) {
      setSubmittedPreview(null);
      setDraft(submittedDraft);
    }
  }

  function handleCancel() {
    if (!isLaunching) {
      setSubmittedPreview(null);
      setDraft("");
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape" && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
      handleCancel();
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && canSubmit) {
      event.preventDefault();
      void handleSubmit();
    }
  }

  function handleConfigureCloud(repository?: SettingsRepositoryEntry) {
    const repoTarget = repository
      ? {
        gitOwner: repository.gitOwner?.trim(),
        gitRepoName: repository.gitRepoName?.trim(),
      }
      : homeNext.cloudRepoTarget;
    const target = repoTarget?.gitOwner && repoTarget.gitRepoName
      ? { gitOwner: repoTarget.gitOwner, gitRepoName: repoTarget.gitRepoName }
      : null;
    if (target) {
      navigate(buildCloudRepoSettingsHref(target.gitOwner, target.gitRepoName));
    }
  }

  return (
    <div className="relative flex h-full w-full min-w-0 flex-1 overflow-hidden bg-background text-foreground" data-telemetry-block>
      <div className="absolute inset-x-0 top-0 h-10" data-tauri-drag-region="true" />
      <main className="flex min-h-0 flex-1 items-center justify-center overflow-auto px-6 py-16">
        <div className="w-full max-w-3xl">
          <div className="mb-5 flex flex-col items-center text-center">
            <p className="max-w-[34rem] text-2xl font-medium leading-tight text-foreground">
              {heading}
            </p>
          </div>

          <ChatComposerSurface>
            <form
              className="relative flex flex-col"
              onSubmit={(event) => {
                event.preventDefault();
                if (canSubmit) void handleSubmit();
              }}
            >
              <div className="px-2 py-1.5">
                <div className="flex w-full flex-wrap items-center justify-start gap-1" />
              </div>
              <div
                className="mb-2 flex-grow select-text overflow-y-auto px-4"
                style={{
                  minHeight: `${HOME_CHAT_COMPOSER_INPUT.minHeightRem}rem`,
                  maxHeight: `${HOME_CHAT_COMPOSER_INPUT.maxRows * CHAT_COMPOSER_INPUT_LINE_HEIGHT_REM}rem`,
                }}
              >
                <ComposerTextarea
                  data-telemetry-mask
                  data-home-composer-editor
                  ref={textareaRef}
                  rows={4}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Describe a task"
                  spellCheck={false}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  style={{
                    minHeight: `${HOME_CHAT_COMPOSER_INPUT.minHeightRem}rem`,
                    maxHeight: `${HOME_CHAT_COMPOSER_INPUT.maxRows * CHAT_COMPOSER_INPUT_LINE_HEIGHT_REM}rem`,
                  }}
                />
              </div>

              <div className="mb-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-[5px] px-2">
                <div className="flex min-w-0 flex-wrap items-center gap-[5px]">
                  <HomeTargetPicker
                    destination={destination}
                    repoLaunchKind={repoLaunchKind}
                    repositories={homeNext.repositories}
                    selectedRepository={homeNext.selectedRepository}
                    selectedBranchName={homeNext.selectedBranchName}
                    branchOptions={homeNext.branchOptions}
                    branchLoading={homeNext.branchQuery.isLoading}
                    cloudActionBySourceRoot={homeNext.cloudRepoActionBySourceRoot}
                    searchValue={targetSearch}
                    onSearchChange={setTargetSearch}
                    onSelectCowork={() => {
                      setDestination("cowork");
                    }}
                    onSelectRepositoryTarget={(sourceRoot, launchKind) => {
                      setDestination("repository");
                      setRepositorySelection({ kind: "repository", sourceRoot });
                      setRepoLaunchKind(launchKind);
                      if (launchKind === "local") {
                        setBaseBranchOverride(null);
                      }
                    }}
                    onSelectBranch={setBaseBranchOverride}
                    onAddRepository={() => handleHomeAction("add-repository")}
                    onConfigureCloud={handleConfigureCloud}
                  />
                  <HomeModelPicker
                    groups={homeNext.modelGroups}
                    selectedModel={homeNext.selectedModel}
                    onSelect={(selection) => {
                      setModelSelectionOverride(selection);
                      setModeOverrideId(null);
                    }}
                  />
                  <HomeModePicker
                    modes={homeNext.modeOptions}
                    selectedMode={homeNext.effectiveMode}
                    onSelect={setModeOverrideId}
                  />
                </div>

                <div className="flex items-center">
                  <ChatComposerActions
                    isRunning={false}
                    isEmpty={draft.trim().length === 0}
                    isDisabled={!canSubmit}
                    onSubmit={() => { void handleSubmit(); }}
                    onCancel={handleCancel}
                  />
                </div>
              </div>
            </form>
          </ChatComposerSurface>

          {submittedPreview ? (
            <div
              key={submittedPreview.id}
              className="mt-5"
              data-home-submit-preview
            >
              <UserMessage
                sessionId={null}
                content={submittedPreview.text}
                contentParts={[{ type: "text", text: submittedPreview.text }]}
              />
            </div>
          ) : null}

          {modelAvailabilityNotice ? (
            <div className="mx-auto mt-2 flex max-w-2xl items-center justify-center gap-2 px-2 text-center text-sm text-muted-foreground">
              <span>{modelAvailabilityNotice.text}</span>
              {modelAvailabilityNotice.actionLabel ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleHomeAction("agent-settings")}
                  className="h-auto px-0 py-0 text-foreground underline underline-offset-4 hover:text-muted-foreground"
                >
                  {modelAvailabilityNotice.actionLabel}
                </Button>
              ) : null}
            </div>
          ) : null}

          {submitDisabledReason ? (
            <div className="mx-auto mt-2 flex max-w-2xl items-center justify-center gap-2 px-2 text-center text-sm text-muted-foreground">
              <span>{submitDisabledReason}</span>
              {repoLaunchKind === "cloud" && homeNext.cloudRepoAction.kind === "configure" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleConfigureCloud()}
                  className="h-auto px-0 py-0 text-foreground underline underline-offset-4 hover:text-muted-foreground"
                >
                  Configure
                </Button>
              ) : null}
            </div>
          ) : null}

          <div className="mx-auto mt-3 max-w-2xl">
            <div className="flex flex-col gap-px">
              {actionCards.map((action) => (
                <Button
                  key={action.id}
                  variant="ghost"
                  size="sm"
                  loading={action.id === "add-repository" && isAddingRepo}
                  onClick={() => handleHomeAction(action.id)}
                  className="h-auto w-full justify-start gap-2 rounded-lg px-3 py-2 text-left text-sm font-normal text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                >
                  {resolveActionIcon(action.id)}
                  <span className="min-w-0 flex-1 truncate">{action.title}</span>
                </Button>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
