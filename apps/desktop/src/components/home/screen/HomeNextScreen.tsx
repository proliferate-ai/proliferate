import { useState } from "react";
import {
  CHAT_COMPOSER_INPUT_LINE_HEIGHT_PX,
  HOME_CHAT_COMPOSER_INPUT,
} from "@/config/chat";
import { HomeOnboardingCards } from "@/components/home/screen/HomeOnboardingCards";
import { HomeProjectMenu } from "@/components/home/screen/HomeProjectMenu";
import { HomeTargetPicker } from "@/components/home/screen/HomeTargetPicker";
import { ChatComposerActions } from "@/components/workspace/chat/input/ChatComposerActions";
import { ComposerModelConfigSelector } from "@/components/workspace/chat/input/ComposerModelConfigSelector";
import { SessionModeControl } from "@/components/workspace/chat/input/SessionModeControl";
import { ChatComposerControlRowFrame } from "@proliferate/product-ui/chat/composer/ChatComposerControlRowFrame";
import { ChatComposerSurface } from "@proliferate/product-ui/chat/composer/ChatComposerSurface";
import { ComposerTextarea } from "@proliferate/ui/primitives/ComposerTextarea";
import { UserMessage } from "@/components/workspace/chat/transcript/UserMessage";
import { Button } from "@proliferate/ui/primitives/Button";
import { useHomeNextLaunchControls } from "@/hooks/home/derived/use-home-next-launch-controls";
import { useHomeCloudRepoSettingsNavigation } from "@/hooks/home/workflows/use-home-cloud-repo-settings-navigation";
import { useHomeNextComposerState } from "@/hooks/home/ui/use-home-next-composer-state";
import { useHomeNextTargetSelectionState } from "@/hooks/home/ui/use-home-next-target-selection-state";
import { useHomeNextState } from "@/hooks/home/derived/use-home-next-state";
import { useHomeScreen } from "@/hooks/home/facade/use-home-screen";
import { buildComposerSessionControlGroups } from "@/lib/domain/chat/session-controls/composer-control-groups";
import {
  buildHomeModeControlDescriptor,
  buildHomeModelSelectorProps,
} from "@/lib/domain/home/home-composer-controls";
import { type HomeNextModelSelection } from "@/lib/domain/home/home-next-launch";
import { resolveHomeModelProbeCardState } from "@/lib/domain/home/home-screen";
import { resolveHomeTargetLaunchKindForRepository } from "@/lib/domain/home/home-target-picker";

export function HomeNextScreen() {
  const {
    destination,
    repositorySelection,
    repoLaunchKind,
    selectedSshTargetId,
    baseBranchOverride,
    patchTargetSelection,
  } = useHomeNextTargetSelectionState();
  const [modelSelectionOverride, setModelSelectionOverride] =
    useState<HomeNextModelSelection | null>(null);
  const [modeOverrideId, setModeOverrideId] = useState<string | null>(null);
  const [launchControlOverrides, setLaunchControlOverrides] = useState<Record<string, string>>({});
  const {
    onboardingCards,
    isAddingRepo,
    handleHomeAction,
    modelProbeInputs,
    dismissModelProbeCard,
  } = useHomeScreen();
  const homeNext = useHomeNextState({
    destination,
    repositorySelection,
    repoLaunchKind,
    modelSelectionOverride,
    baseBranchOverride,
    modeOverrideId,
    selectedSshTargetId,
  });
  const homeLaunchControls = useHomeNextLaunchControls({
    modelSelection: homeNext.effectiveModelSelection,
    modeId: homeNext.effectiveModeId,
    controlOverrides: launchControlOverrides,
    onSelectControl: (controlKey, value) => {
      setLaunchControlOverrides((current) => ({
        ...current,
        [controlKey]: value,
      }));
    },
  });
  const configureCloud = useHomeCloudRepoSettingsNavigation(homeNext.cloudRepoTarget);
  const composer = useHomeNextComposerState({
    targetDisabledReason: homeNext.targetDisabledReason,
    modelAvailabilityState: homeNext.modelAvailabilityState,
    canLaunchTarget: homeNext.canLaunchTarget,
    modelSelection: homeNext.effectiveModelSelection,
    modeId: homeNext.effectiveModeId,
    launchControlValues: homeLaunchControls.launchControlValues,
    launchTarget: homeNext.launchTarget,
  });
  const homeComposerInputMaxHeight =
    `${CHAT_COMPOSER_INPUT_LINE_HEIGHT_PX * HOME_CHAT_COMPOSER_INPUT.maxRows}px`;

  // Unified composer (owner rev 2026-07-01): home renders the SAME control-row
  // components as the chat input (SessionModeControl + ComposerModelConfigSelector),
  // fed by launch-time adapters instead of live-session state.
  const homeAgentKind = homeNext.effectiveModelSelection?.kind ?? null;
  const launchControlGroups = buildComposerSessionControlGroups(homeLaunchControls.controls);
  // Mode always comes from the home adapter: useHomeNextLaunchControls filters
  // mode keys out of `controls`, so launchControlGroups.modeControl never fires.
  const homeModeControl = buildHomeModeControlDescriptor({
    modes: homeNext.modeOptions,
    selectedModeId: homeNext.effectiveMode?.value ?? null,
    onSelect: setModeOverrideId,
  });
  const homeModelSelectorProps = buildHomeModelSelectorProps({
    groups: homeNext.modelGroups,
    selectedModel: homeNext.selectedModel,
    availabilityState: homeNext.modelAvailabilityState,
    onSelect: (selection) => {
      setModelSelectionOverride(selection);
      setModeOverrideId(null);
      setLaunchControlOverrides({});
    },
  });

  const promptTarget = destination === "repository"
    ? homeNext.selectedRepository?.name?.trim()
    : null;
  // Model-probe onboarding card (spec §10). Inputs may be absent when the
  // facade is mocked; hide the card in that case.
  const modelProbeState = modelProbeInputs
    ? resolveHomeModelProbeCardState({
      ...modelProbeInputs,
      modelCount: homeNext.modelGroups.reduce(
        (count, group) => count + group.models.length,
        0,
      ),
      agentSetupCardVisible: onboardingCards.some((card) => card.id === "agent-defaults"),
    })
    : undefined;
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
  return (
    <div className="relative flex h-full w-full min-w-0 flex-1 overflow-hidden bg-background text-foreground" data-telemetry-block>
      <div className="absolute inset-x-0 top-0 h-10" data-tauri-drag-region="true" />
      <main className="flex min-h-0 flex-1 items-center justify-center overflow-auto px-6 py-16">
        <div className="w-full max-w-3xl">
          {/* Hero heading (spec §1.1): 28px / 400 / centered; the project name
              is an inline menu trigger with a pill hover fill. */}
          <div className="mb-5 flex flex-col items-center text-center">
            <h1 className="max-w-full whitespace-pre-wrap text-[28px] font-normal leading-9 text-foreground">
              <span className="group/title inline-block max-w-full">
                {promptTarget ? (
                  <>
                    {"What should we build in "}
                    <HomeProjectMenu
                      trigger={(
                        <button
                          type="button"
                          aria-label={`Change project: ${promptTarget}`}
                          className="relative z-0 inline-block cursor-pointer whitespace-pre outline-none after:absolute after:-inset-x-1.5 after:inset-y-0 after:-z-10 after:rounded-xl after:content-[''] hover:after:bg-accent focus-visible:after:bg-accent data-[state=open]:after:bg-accent"
                        >
                          {promptTarget}
                        </button>
                      )}
                      side="bottom"
                      destination={destination}
                      repositories={homeNext.repositories}
                      selectedRepository={homeNext.selectedRepository}
                      onSelectRepository={(sourceRoot) => {
                        const launchKind = resolveHomeTargetLaunchKindForRepository({
                          currentLaunchKind: repoLaunchKind,
                          sourceRoot,
                          cloudActionBySourceRoot: homeNext.cloudRepoActionBySourceRoot,
                        });
                        patchTargetSelection({
                          destination: "repository",
                          repositorySelection: { kind: "repository", sourceRoot },
                          repoLaunchKind: launchKind,
                        });
                      }}
                      onSelectCowork={() => {
                        patchTargetSelection({ destination: "cowork" });
                      }}
                      onAddRepository={() => handleHomeAction("add-repository")}
                    />
                    ?
                  </>
                ) : (
                  "What should we build?"
                )}
              </span>
            </h1>
          </div>

          <div className="relative z-10">
          <ChatComposerSurface>
            <form
              className="relative flex flex-col"
              onSubmit={(event) => {
                event.preventDefault();
                if (composer.canSubmit) void composer.submit();
              }}
            >
              <div
                className="mt-3 mb-2 flex-grow select-text overflow-y-auto px-4"
                style={{
                  minHeight: `${HOME_CHAT_COMPOSER_INPUT.minHeightRem}rem`,
                  maxHeight: homeComposerInputMaxHeight,
                }}
              >
                <ComposerTextarea
                  data-telemetry-mask
                  data-home-composer-editor
                  ref={composer.textareaRef}
                  rows={2}
                  value={composer.draft}
                  onChange={(event) => composer.setDraft(event.target.value)}
                  onKeyDown={composer.handleKeyDown}
                  placeholder="Describe a task"
                  spellCheck={false}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  style={{
                    minHeight: `${HOME_CHAT_COMPOSER_INPUT.minHeightRem}rem`,
                    maxHeight: homeComposerInputMaxHeight,
                  }}
                />
              </div>

              <ChatComposerControlRowFrame
                leading={homeModeControl ? (
                  <SessionModeControl
                    agentKind={homeAgentKind}
                    control={homeModeControl}
                    triggerStyle="value"
                  />
                ) : null}
                trailing={(
                  <ComposerModelConfigSelector
                    modelSelectorProps={homeModelSelectorProps}
                    agentKind={homeAgentKind}
                    controls={launchControlGroups.modelConfigControls}
                  />
                )}
                action={(
                  <ChatComposerActions
                    isRunning={false}
                    isEmpty={composer.draft.trim().length === 0}
                    isDisabled={!composer.canSubmit}
                    onSubmit={() => { void composer.submit(); }}
                    onCancel={composer.cancel}
                  />
                )}
              />
            </form>
          </ChatComposerSurface>
          </div>

          {/* Target row (spec §1.3): codex home footer — a tray tucked under
              the composer (`-mt` behind it, rounded-b, sidebar bg) so the
              selectors read as attached to the composer, not floating. */}
          <div className="relative z-0 -mx-px -mt-[18px] flex min-w-0 flex-wrap items-center justify-start gap-1 overflow-hidden rounded-b-2xl bg-sidebar px-2 pb-2 pt-[25px]">
            <HomeTargetPicker
              destination={destination}
              repoLaunchKind={repoLaunchKind}
              repositories={homeNext.repositories}
              selectedRepository={homeNext.selectedRepository}
              selectedBranchName={homeNext.selectedBranchName}
              branchOptions={homeNext.branchOptions}
              branchLoading={homeNext.branchQuery.isLoading}
              cloudActionBySourceRoot={homeNext.cloudRepoActionBySourceRoot}
              sshTargetOptions={homeNext.sshTargetOptions}
              selectedSshTargetId={selectedSshTargetId}
              sshTargetsLoading={homeNext.sshTargetsLoading}
              onSelectCowork={() => {
                patchTargetSelection({ destination: "cowork" });
              }}
              onSelectRepository={(sourceRoot) => {
                const launchKind = resolveHomeTargetLaunchKindForRepository({
                  currentLaunchKind: repoLaunchKind,
                  sourceRoot,
                  cloudActionBySourceRoot: homeNext.cloudRepoActionBySourceRoot,
                });
                patchTargetSelection({
                  destination: "repository",
                  repositorySelection: { kind: "repository", sourceRoot },
                  repoLaunchKind: launchKind,
                });
              }}
              onSelectRuntime={(launchKind, targetId = null) => {
                patchTargetSelection({
                  repoLaunchKind: launchKind,
                  selectedSshTargetId: launchKind === "ssh" ? targetId : selectedSshTargetId,
                });
              }}
              onSelectBranch={(branchName) => {
                patchTargetSelection({ baseBranchOverride: branchName });
              }}
              onAddRepository={() => handleHomeAction("add-repository")}
              onConfigureCloud={configureCloud}
            />
          </div>

          {composer.submittedPreview ? (
            <div
              key={composer.submittedPreview.id}
              className="mt-5"
              data-home-submit-preview
            >
              <UserMessage
                sessionId={null}
                content={composer.submittedPreview.text}
                contentParts={[{ type: "text", text: composer.submittedPreview.text }]}
              />
            </div>
          ) : null}

          {modelAvailabilityNotice ? (
            <div className="mx-auto mt-2 flex max-w-2xl items-center justify-center gap-2 px-2 text-center text-[12px] text-muted-foreground">
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

          {composer.submitDisabledReason ? (
            <div className="mx-auto mt-2 flex max-w-2xl items-center justify-center gap-2 px-2 text-center text-[12px] text-muted-foreground">
              <span>{composer.submitDisabledReason}</span>
              {repoLaunchKind === "cloud" && homeNext.cloudRepoAction.kind === "configure" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => configureCloud()}
                  className="h-auto px-0 py-0 text-foreground underline underline-offset-4 hover:text-muted-foreground"
                >
                  Configure
                </Button>
              ) : null}
            </div>
          ) : null}

          <HomeOnboardingCards
            cards={onboardingCards}
            isAddingRepo={isAddingRepo}
            onSelect={(card) => handleHomeAction(card.id)}
            modelProbe={modelProbeState}
            onOpenAgents={() => handleHomeAction("agent-settings")}
            onDismissModelProbe={dismissModelProbeCard}
          />
        </div>
      </main>
    </div>
  );
}
