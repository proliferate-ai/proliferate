import type { FormEvent } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ConfirmationDialog } from "@proliferate/ui/primitives/ConfirmationDialog";
import { Input } from "@proliferate/ui/primitives/Input";
import { ModalShell } from "@proliferate/ui/primitives/ModalShell";
import { Textarea } from "@proliferate/ui/primitives/Textarea";
import { AutomationRunLocationSelector } from "@/components/automations/controls/AutomationRunLocationSelector";
import { AutomationAgentHarnessControls } from "@/components/automations/editor/AutomationAgentHarnessControls";
import {
  AutomationSchedulePopover,
  AutomationTemplatePopover,
} from "@/components/automations/editor/AutomationEditorControls";
import type { AutomationTargetGroup, AutomationTargetSelection } from "@/lib/domain/automations/target/selection";
import type { AutomationRecord } from "@/lib/domain/automations/run/ui-records";
import type { AutomationOwnerScope } from "@/lib/domain/automations/run/types";
import type {
  DesktopAgentLaunchAgent,
  DesktopAgentLaunchModel,
} from "@/lib/domain/agents/cloud-launch-catalog";
import type { LiveSessionControlDescriptor } from "@/lib/domain/chat/session-controls/session-controls";
import type { AutomationSchedulePresetOrCustom } from "@/lib/domain/automations/schedule/schedule";

interface AutomationOwnerOption {
  value: AutomationOwnerScope;
  label: string;
  description: string;
  disabledReason?: string | null;
}

interface AutomationEditorDialogProps {
  open: boolean;
  automation: AutomationRecord | null;
  busy: boolean;
  error: string | null;
  title: string;
  prompt: string;
  ownerScope: AutomationOwnerScope;
  ownerOptions: AutomationOwnerOption[];
  personalGroups: AutomationTargetGroup[];
  teamGroups: AutomationTargetGroup[];
  targetSelectionLoading: boolean;
  targetDisabledReason: string | null;
  schedulePreset: AutomationSchedulePresetOrCustom;
  rrule: string;
  timezone: string;
  agents: DesktopAgentLaunchAgent[];
  selectedAgent: DesktopAgentLaunchAgent | null;
  selectedModel: DesktopAgentLaunchModel | null;
  controls: LiveSessionControlDescriptor[];
  agentsLoading: boolean;
  savingRunConfig: boolean;
  agentSelectionReady: boolean;
  canSubmitTarget: boolean;
  pendingConfigureTarget: { gitOwner: string; gitRepoName: string; ownerScope: AutomationOwnerScope } | null;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onTitleChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onSelectOwner: (ownerScope: AutomationOwnerScope) => void;
  onSelectTarget: (target: AutomationTargetSelection) => void;
  onConfigureCloudTarget: (target: {
    gitOwner: string;
    gitRepoName: string;
    ownerScope: AutomationOwnerScope;
  }) => void;
  onSchedulePresetChange: (value: AutomationSchedulePresetOrCustom) => void;
  onRruleChange: (value: string) => void;
  onTimezoneChange: (value: string) => void;
  onRruleBlur: () => void;
  onSelectModel: (agent: DesktopAgentLaunchAgent, model: DesktopAgentLaunchModel) => void;
  onCancelConfigureTarget: () => void;
  onConfirmConfigureTarget: () => void;
}

export function AutomationEditorDialog({
  open,
  automation,
  busy,
  error,
  title,
  prompt,
  ownerScope,
  ownerOptions,
  personalGroups,
  teamGroups,
  targetSelectionLoading,
  targetDisabledReason,
  schedulePreset,
  rrule,
  timezone,
  agents,
  selectedAgent,
  selectedModel,
  controls,
  agentsLoading,
  savingRunConfig,
  agentSelectionReady,
  canSubmitTarget,
  pendingConfigureTarget,
  onClose,
  onSubmit,
  onTitleChange,
  onPromptChange,
  onSelectOwner,
  onSelectTarget,
  onConfigureCloudTarget,
  onSchedulePresetChange,
  onRruleChange,
  onTimezoneChange,
  onRruleBlur,
  onSelectModel,
  onCancelConfigureTarget,
  onConfirmConfigureTarget,
}: AutomationEditorDialogProps) {
  return (
    <>
      <ModalShell
        open={open}
        onClose={onClose}
        disableClose={busy || pendingConfigureTarget !== null}
        title={automation ? "Edit workflow" : "Create workflow"}
        description="Create a scheduled workflow."
        sizeClassName="max-h-[95vh] max-w-[800px]"
        bodyClassName="flex min-h-[24rem] flex-col px-5 pb-5 pt-0"
        panelClassName="border-border bg-background/95 shadow-lg backdrop-blur-xl"
        headerContent={(
          <div className="flex min-w-0 items-center justify-between gap-4 pt-2">
            <Input
              id="automation-title"
              data-testid="automation-title-input"
              value={title}
              onChange={(event) => onTitleChange(event.target.value)}
              aria-label="Workflow title"
              placeholder="Workflow title"
              className="h-auto min-w-0 border-0 bg-transparent px-0 py-0 pr-2 text-lg leading-tight shadow-none outline-none placeholder:text-muted-foreground focus:ring-0"
            />
            <AutomationTemplatePopover
              onSelectTemplate={(template) => {
                if (!title.trim()) {
                  onTitleChange(template.title);
                }
                onPromptChange(template.prompt);
              }}
            />
          </div>
        )}
      >
        <form
          id="automation-form"
          onSubmit={onSubmit}
          className="flex min-h-0 flex-1 flex-col"
        >
          {error && (
            <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-3">
            <AutomationRunLocationSelector
              ownerScope={ownerScope}
              canChangeOwner={!automation}
              ownerOptions={ownerOptions}
              personalGroups={personalGroups}
              teamGroups={teamGroups}
              isLoading={targetSelectionLoading}
              disabledReason={targetDisabledReason}
              onSelectOwner={onSelectOwner}
              onSelectTarget={onSelectTarget}
              onConfigureCloud={onConfigureCloudTarget}
            />
            <Textarea
              id="automation-prompt"
              variant="ghost"
              value={prompt}
              onChange={(event) => onPromptChange(event.target.value)}
              aria-label="Prompt"
              placeholder="Add prompt e.g. look for crashes in $sentry"
              className="min-h-[12rem] px-0 text-base leading-relaxed placeholder:text-muted-foreground"
            />
          </div>
          <div className="shrink-0 pt-3">
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                <AutomationSchedulePopover
                  schedulePreset={schedulePreset}
                  rrule={rrule}
                  timezone={timezone}
                  onSchedulePresetChange={onSchedulePresetChange}
                  onRruleChange={onRruleChange}
                  onTimezoneChange={onTimezoneChange}
                  onRruleBlur={onRruleBlur}
                />
                <AutomationAgentHarnessControls
                  agents={agents}
                  selectedAgent={selectedAgent}
                  selectedModel={selectedModel}
                  controls={controls}
                  loading={agentsLoading}
                  onSelectModel={onSelectModel}
                />
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  loading={busy || savingRunConfig}
                  disabled={
                    (!automation && (agentsLoading || targetSelectionLoading))
                    || savingRunConfig
                    || !agentSelectionReady
                    || !canSubmitTarget
                  }
                >
                  {automation ? "Save" : "Create"}
                </Button>
              </div>
            </div>
          </div>
        </form>
      </ModalShell>
      <ConfirmationDialog
        open={pendingConfigureTarget !== null}
        onClose={onCancelConfigureTarget}
        onConfirm={onConfirmConfigureTarget}
        title="Discard workflow draft?"
        description="Opening cloud repo settings will close this workflow draft."
        confirmLabel="Open settings"
      />
    </>
  );
}
