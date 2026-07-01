import { useState } from "react";
import { HomeComposerForm } from "@/components/home/screen/HomeComposerForm";
import { HomeModePicker } from "@/components/home/screen/HomeModePicker";
import { HomeModelPicker } from "@/components/home/screen/HomeModelPicker";
import { HomeOnboardingCards } from "@/components/home/screen/HomeOnboardingCards";
import { HomeTargetPicker } from "@/components/home/screen/HomeTargetPicker";
import { SessionConfigControls } from "@/components/workspace/chat/input/SessionConfigControls";
import { Button } from "@proliferate/ui/primitives/Button";
import { useHomeNextLaunchControls } from "@/hooks/home/derived/use-home-next-launch-controls";
import { useHomeCloudRepoSettingsNavigation } from "@/hooks/home/workflows/use-home-cloud-repo-settings-navigation";
import { useHomeNextTargetSelectionState } from "@/hooks/home/ui/use-home-next-target-selection-state";
import { useHomeNextState } from "@/hooks/home/derived/use-home-next-state";
import { useHomeScreen } from "@/hooks/home/facade/use-home-screen";
import { type HomeNextModelSelection } from "@/lib/domain/home/home-next-launch";
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

  const promptTarget = destination === "repository"
    ? homeNext.selectedRepository?.name?.trim()
    : null;
  const heading = promptTarget
    ? `What should we build in ${promptTarget}?`
    : "What should we build?";
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
          <div className="mb-5 flex flex-col items-center text-center">
            <p className="max-w-[34rem] text-2xl font-medium leading-tight text-foreground">
              {heading}
            </p>
          </div>

          <HomeComposerForm
            targetDisabledReason={homeNext.targetDisabledReason}
            modelAvailabilityState={homeNext.modelAvailabilityState}
            canLaunchTarget={homeNext.canLaunchTarget}
            modelSelection={homeNext.effectiveModelSelection}
            modeId={homeNext.effectiveModeId}
            launchControlValues={homeLaunchControls.launchControlValues}
            launchTarget={homeNext.launchTarget}
            controlsSlot={
              <>
                <HomeModelPicker
                  groups={homeNext.modelGroups}
                  selectedModel={homeNext.selectedModel}
                  onSelect={(selection) => {
                    setModelSelectionOverride(selection);
                    setModeOverrideId(null);
                    setLaunchControlOverrides({});
                  }}
                />
                <HomeModePicker
                  modes={homeNext.modeOptions}
                  selectedMode={homeNext.effectiveMode}
                  onSelect={setModeOverrideId}
                />
                <SessionConfigControls
                  agentKind={homeNext.effectiveModelSelection?.kind ?? null}
                  controls={homeLaunchControls.controls}
                />
              </>
            }
            targetPickerSlot={
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
            }
            modelAvailabilityNoticeSlot={
              modelAvailabilityNotice ? (
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
              ) : null
            }
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
            onboardingSlot={
              <HomeOnboardingCards
                cards={onboardingCards}
                isAddingRepo={isAddingRepo}
                onSelect={(card) => handleHomeAction(card.id)}
              />
            }
          />
        </div>
      </main>
    </div>
  );
}
