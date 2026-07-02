import { useState } from "react";
import { HomeComposerForm } from "@/components/home/screen/HomeComposerForm";
import { HomeOnboardingCards } from "@/components/home/screen/HomeOnboardingCards";
import { HomeProjectMenu } from "@/components/home/screen/HomeProjectMenu";
import { HomeTargetPicker } from "@/components/home/screen/HomeTargetPicker";
import { ComposerModelConfigSelector } from "@/components/workspace/chat/input/ComposerModelConfigSelector";
import { SessionModeControl } from "@/components/workspace/chat/input/SessionModeControl";
import { Button } from "@proliferate/ui/primitives/Button";
import { useHomeNextLaunchControls } from "@/hooks/home/derived/use-home-next-launch-controls";
import { useHomeCloudRepoSettingsNavigation } from "@/hooks/home/workflows/use-home-cloud-repo-settings-navigation";
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
            <h1 className="max-w-full whitespace-pre-wrap text-hero font-normal text-foreground">
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

          <HomeComposerForm
            targetDisabledReason={homeNext.targetDisabledReason}
            modelAvailabilityState={homeNext.modelAvailabilityState}
            canLaunchTarget={homeNext.canLaunchTarget}
            modelSelection={homeNext.effectiveModelSelection}
            modeId={homeNext.effectiveModeId}
            launchControlValues={homeLaunchControls.launchControlValues}
            launchTarget={homeNext.launchTarget}
            controlsSlot={homeModeControl ? (
              <SessionModeControl
                agentKind={homeAgentKind}
                control={homeModeControl}
                triggerStyle="value"
              />
            ) : null}
            controlsTrailingSlot={(
              <ComposerModelConfigSelector
                modelSelectorProps={homeModelSelectorProps}
                agentKind={homeAgentKind}
                controls={launchControlGroups.modelConfigControls}
              />
            )}
            targetPickerSlot={(
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
            )}
            modelAvailabilityNoticeSlot={modelAvailabilityNotice ? (
              <div className="mx-auto mt-2 flex max-w-2xl items-center justify-center gap-2 px-2 text-center text-ui-sm text-muted-foreground">
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
            submitDisabledReasonCtaSlot={
              repoLaunchKind === "cloud" && homeNext.cloudRepoAction.kind === "configure" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => configureCloud()}
                  className="h-auto px-0 py-0 text-foreground underline underline-offset-4 hover:text-muted-foreground"
                >
                  Configure
                </Button>
              ) : null
            }
            onboardingSlot={(
              <HomeOnboardingCards
                cards={onboardingCards}
                isAddingRepo={isAddingRepo}
                onSelect={(card) => handleHomeAction(card.id)}
                modelProbe={modelProbeState}
                onOpenAgents={() => handleHomeAction("agent-settings")}
                onDismissModelProbe={dismissModelProbeCard}
              />
            )}
          />
        </div>
      </main>
    </div>
  );
}
