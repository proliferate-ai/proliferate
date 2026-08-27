import { useRef, useState } from "react";
import { HomeComposerForm } from "#product/components/home/screen/HomeComposerForm";
import { HomeOnboardingCards } from "#product/components/home/screen/HomeOnboardingCards";
import { HomeProjectMenu } from "#product/components/home/screen/HomeProjectMenu";
import { HomeTargetPicker } from "#product/components/home/screen/HomeTargetPicker";
import {
  ComposerLeadingControls,
  ComposerTrailingControls,
} from "#product/components/workspace/chat/input/ChatInputControlRow";
import { CHAT_INPUT_ATTACHMENT_ACCEPT } from "#product/config/chat";
import {
  CHAT_SURFACE_GUTTER_CLASSNAME,
} from "#product/config/chat-layout";
import { DebugProfiler } from "#product/components/diagnostics/DebugProfiler";
import { Button } from "#product/primitives/Button";
import { Input } from "#product/primitives/Input";
import { useHomeComposerAttachments } from "#product/hooks/home/ui/use-home-composer-attachments";
import { useHomeNextLaunchControls } from "#product/hooks/home/derived/use-home-next-launch-controls";
import { useHomeCloudRepoSettingsNavigation } from "#product/hooks/home/workflows/use-home-cloud-repo-settings-navigation";
import { useHomeNextTargetSelectionState } from "#product/hooks/home/ui/use-home-next-target-selection-state";
import { useHomeInstallationReadiness } from "#product/hooks/home/derived/use-home-installation-readiness";
import { useHomeNextState } from "#product/hooks/home/derived/use-home-next-state";
import { useHomeScreen } from "#product/hooks/home/facade/use-home-screen";
import {
  buildHomeModelSelectorProps,
  buildHomeSessionConfigControls,
} from "#product/lib/domain/home/home-composer-controls";
import { resolveHomeModelGateNotice } from "#product/lib/domain/home/home-model-gate";
import { type HomeNextModelSelection } from "#product/lib/domain/home/home-next-launch";
import { resolveHomeTargetLaunchKindForRepository } from "#product/lib/domain/home/home-target-picker";

export function HomeNextScreen() {
  const {
    desktopTargetsAvailable,
    destination,
    repositorySelection,
    repoLaunchKind,
    baseBranchOverride,
    patchTargetSelection,
  } = useHomeNextTargetSelectionState();
  const [modelSelectionOverride, setModelSelectionOverride] =
    useState<HomeNextModelSelection | null>(null);
  const [launchControlOverrides, setLaunchControlOverrides] = useState<Record<string, string>>({});
  const {
    onboardingCards,
    isAddingRepo,
    handleHomeAction,
    authSetupEvidence,
  } = useHomeScreen();
  const homeNext = useHomeNextState({
    desktopTargetsAvailable,
    destination,
    repositorySelection,
    repoLaunchKind,
    modelSelectionOverride,
    baseBranchOverride,
  });
  const homeLaunchControls = useHomeNextLaunchControls({
    modelSelection: homeNext.effectiveModelSelection,
    launchTarget: homeNext.launchTarget,
    controlOverrides: launchControlOverrides,
    onSelectControl: (controlKey, value) => {
      setLaunchControlOverrides((current) => ({
        ...current,
        [controlKey]: value,
      }));
    },
  });
  const configureCloud = useHomeCloudRepoSettingsNavigation(homeNext.cloudRepoTarget);
  // Unified composer (owner rev 2026-07-01, extended 2026-07-07): home renders
  // the SAME control clusters as the chat input (ComposerLeadingControls +
  // ComposerTrailingControls from ChatInputControlRow), fed by launch-time
  // adapters instead of live-session state. Session-only controls degrade via
  // their own gating (goal needs activeSessionId; attachments run on a
  // home-scoped controller with optimistic pre-session capabilities and ride
  // the launch as prompt snapshots — see useHomeNextComposerState.submit).
  const homeAgentKind = homeNext.effectiveModelSelection?.kind ?? null;
  const {
    attachments,
    fileDragOver,
    handleFileDrag,
    handleDrop,
    handleDragLeave,
  } = useHomeComposerAttachments(homeNext.launchTarget?.kind ?? null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const homeSessionConfigControls = buildHomeSessionConfigControls({
    launchControls: homeLaunchControls.controls,
  });
  const homeModelSelectorProps = buildHomeModelSelectorProps({
    groups: homeNext.modelGroups,
    selectedModel: homeNext.selectedModel,
    gate: homeNext.modelGate,
    isCatalogLoading: homeNext.isCatalogLoading,
    hasKnownAgents: homeNext.hasKnownAgents,
    onSelect: (selection) => {
      setModelSelectionOverride(selection);
      setLaunchControlOverrides({});
    },
  });
  const launchKindForRepository = (sourceRoot: string) =>
    desktopTargetsAvailable
      ? resolveHomeTargetLaunchKindForRepository({
        currentLaunchKind: repoLaunchKind,
        sourceRoot,
        cloudActionBySourceRoot: homeNext.cloudRepoActionBySourceRoot,
      })
      : "cloud";

  const promptTarget = destination === "repository"
    ? homeNext.selectedRepository?.name?.trim()
    : null;
  // Readiness card (UX spec §10 revision, ruling 4): bound to per-agent
  // readiness and the two gate values it may consume (selection_required,
  // launchable), sourced from the live reconcile job snapshot rather than
  // the agents list (D-R1/D-R2). Unmounts entirely once the install job
  // resolves — there is no "done" state, so a null result just omits the
  // card.
  const readinessCard = useHomeInstallationReadiness(homeNext.modelGate.kind);
  const homeOnboardingVisible = onboardingCards.length > 0
    || (authSetupEvidence !== undefined && authSetupEvidence !== null)
    || readinessCard !== null;
  // One mapping, keyed on the gate. Every silent arm is silent on purpose:
  // selection_required and observed_empty are cured by the enabled picker
  // itself (owner revisions r2/r3), and the in-flight arms belong to the
  // install toast. "Finish agent setup to start a chat." can only be reached
  // through blocked(agent_setup_required), which requires real
  // install_required/login_required readiness.
  // A refused probe writes no durable state, so the gate cannot move and the
  // same sentence would render again unchanged. The notice says so instead.
  const modelAvailabilityNotice = resolveHomeModelGateNotice(homeNext.modelGate, {
    refreshPending: homeNext.retryPending,
    refreshRejected: homeNext.retryRejected,
  });
  const runModelGateNoticeAction = () => {
    if (modelAvailabilityNotice?.action === "agent_settings") {
      handleHomeAction("agent-settings", { harnessKind: homeNext.unsupportedHarnessKind });
      return;
    }
    homeNext.retryModelObservation();
  };
  return (
    <div
      className="relative flex h-full w-full min-w-0 flex-1 overflow-hidden bg-background text-foreground"
      data-telemetry-block
      onDragEnter={handleFileDrag}
      onDragOver={handleFileDrag}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="absolute inset-x-0 top-0 h-[46px]" data-tauri-drag-region="true" />
      <Input
        ref={fileInputRef}
        variant="unstyled"
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          if (event.target.files) {
            attachments.addFiles(event.target.files);
          }
          event.target.value = "";
        }}
        accept={CHAT_INPUT_ATTACHMENT_ACCEPT}
      />
      {fileDragOver && (
        <div
          className="pointer-events-none absolute inset-2 z-overlay rounded-xl border border-dashed border-primary/70 bg-primary/5"
          aria-hidden="true"
        />
      )}
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className={`flex min-h-0 flex-1 basis-0 items-end justify-center pb-24 ${CHAT_SURFACE_GUTTER_CLASSNAME}`}>
          <div className="relative mx-auto w-full max-w-transcript-thread">
            <div className="flex flex-col items-center text-center">
              <h1 className="max-w-full whitespace-pre-wrap text-hero font-medium text-foreground select-none">
                <span className="group/title inline-block max-w-full">
                  {promptTarget ? (
                    <>
                      {"What should we build in "}
                      <HomeProjectMenu
                        trigger={(
                          <Button
                            type="button"
                            variant="unstyled"
                            size="unstyled"
                            aria-label={`Change project: ${promptTarget}`}
                            className="inline-block cursor-pointer whitespace-pre underline decoration-dotted decoration-1 decoration-foreground/50 underline-offset-4 outline-none transition-opacity hover:opacity-65 focus-visible:opacity-65 data-[state=open]:opacity-65"
                          >
                            {promptTarget}
                          </Button>
                        )}
                        coworkAvailable={desktopTargetsAvailable}
                        side="bottom"
                        destination={destination}
                        repositories={homeNext.repositories}
                        selectedRepository={homeNext.selectedRepository}
                        onSelectRepository={(sourceRoot) => {
                          patchTargetSelection({
                            destination: "repository",
                            repositorySelection: { kind: "repository", sourceRoot },
                            repoLaunchKind: launchKindForRepository(sourceRoot),
                          });
                        }}
                        onSelectCowork={() => {
                          patchTargetSelection({ destination: "cowork" });
                        }}
                      />
                      ?
                    </>
                  ) : (
                    "What should we build?"
                  )}
                </span>
              </h1>
            </div>

            {homeOnboardingVisible ? (
              <div
                className="absolute inset-x-[29px] top-full mt-8"
                data-home-onboarding-region
              >
                <DebugProfiler id="home-onboarding">
                  <HomeOnboardingCards
                    cards={onboardingCards}
                    isAddingRepo={isAddingRepo}
                    onSelect={(card) => handleHomeAction(card.id)}
                    authSetupEvidence={authSetupEvidence}
                    readinessCard={readinessCard}
                    onOpenAgents={() => handleHomeAction("agent-settings")}
                  />
                </DebugProfiler>
              </div>
            ) : null}
          </div>
        </div>

        <div className="min-h-0 flex-1 basis-0" />

        <div
          className={`relative z-raised shrink-0 pb-4 pt-1.5 ${CHAT_SURFACE_GUTTER_CLASSNAME}`}
          data-home-composer-dock
        >
          <div className="mx-auto w-full max-w-transcript-thread">
            <HomeComposerForm
              targetDisabledReason={homeNext.targetDisabledReason}
              modelGate={homeNext.modelGate}
              canLaunchTarget={homeNext.canLaunchTarget}
              modelSelection={homeNext.effectiveModelSelection}
              launchControlValues={homeLaunchControls.launchControlValues}
              launchTarget={homeNext.launchTarget}
              attachments={attachments}
              controlsSlot={(
                <ComposerLeadingControls
                  runtimeControlsDisabled={false}
                  modelSelectorProps={homeModelSelectorProps}
                  agentKind={homeAgentKind}
                  sessionConfigControls={homeSessionConfigControls}
                  activeSessionId={null}
                />
              )}
              controlsTrailingSlot={(
                <ComposerTrailingControls
                  runtimeControlsDisabled={false}
                  isEditingQueuedPrompt={false}
                  chatDisabled={false}
                  isSubmitting={false}
                  supportsAttachments={attachments.supportsAttachments}
                  canAttachFiles={attachments.canAttachFiles}
                  activeSessionId={null}
                  onAttachFile={() => fileInputRef.current?.click()}
                />
              )}
              targetPickerSlot={(
                <HomeTargetPicker
                  desktopTargetsAvailable={desktopTargetsAvailable}
                  destination={destination}
                  repoLaunchKind={repoLaunchKind}
                  repositories={homeNext.repositories}
                  selectedRepository={homeNext.selectedRepository}
                  selectedBranchName={homeNext.selectedBranchName}
                  branchOptions={homeNext.branchOptions}
                  branchLoading={homeNext.branchQuery.isLoading}
                  cloudActionBySourceRoot={homeNext.cloudRepoActionBySourceRoot}
                  onSelectCowork={() => {
                    patchTargetSelection({ destination: "cowork" });
                  }}
                  onSelectRepository={(sourceRoot) => {
                    patchTargetSelection({
                      destination: "repository",
                      repositorySelection: { kind: "repository", sourceRoot },
                      repoLaunchKind: launchKindForRepository(sourceRoot),
                    });
                  }}
                  onSelectRuntime={(launchKind) => {
                    if (!desktopTargetsAvailable && launchKind !== "cloud") return;
                    patchTargetSelection({
                      repoLaunchKind: launchKind,
                    });
                  }}
                  onSelectBranch={(branchName) => {
                    patchTargetSelection({ baseBranchOverride: branchName });
                  }}
                  onConfigureCloud={configureCloud}
                />
              )}
              modelAvailabilityNoticeSlot={modelAvailabilityNotice ? (
                <div className="mx-auto mt-2 flex max-w-2xl items-center justify-center gap-2 px-2 text-center text-ui-sm text-muted-foreground">
                  <span>{modelAvailabilityNotice.text}</span>
                  {/* Ruling 5: a notice that names a cure carries an ENABLED
                      action for it. The single terminal state names none —
                      a button that cannot change anything is the dead end
                      this gate removes, not a cure. */}
                  {/* Never disabled: this is the only affordance on states
                      with no guaranteed exit, and the hook already ignores a
                      press while its own batch is in flight. */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={runModelGateNoticeAction}
                    className="h-auto px-0 py-0 text-foreground underline underline-offset-4 hover:text-muted-foreground"
                  >
                    {modelAvailabilityNotice.actionLabel}
                  </Button>
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
                    {homeNext.cloudRepoAction.label}
                  </Button>
                ) : null
              }
            />
          </div>
        </div>
      </main>
    </div>
  );
}
