import { useState } from "react";
import { useAddRepoFlowController } from "#product/hooks/workspaces/workflows/use-add-repo-flow-controller";
import {
  AddRepositoryPopover,
  type AddRepoFlowStep,
} from "#product/components/workspace/repo-setup/AddRepositoryPopover";

export interface AddRepositoryFlowPanelProps {
  /** Dismiss the surface hosting this panel — an add completed, or a step
   * handed off to another flow (cloud intent, clone intent, sign-in). */
  onClose: () => void;
  /**
   * Leave the ENTRY step without leaving the surface. The project menu's sweep
   * passes this (Back returns to the project list); a popover whose whole
   * content is the flow leaves it unset, because entry is its root.
   */
  onExitEntry?: (() => void) | null;
  entryTitle?: string;
}

/**
 * The add-repository flow, wired, for surfaces that anchor it themselves.
 *
 * Mount it only while the surface is showing (Radix unmounts closed popover
 * content, which is what resets the step): the controller's queries are gated
 * on being visible, so an unmounted panel costs nothing and a re-opened one
 * always starts at the entry menu.
 */
export function AddRepositoryFlowPanel({
  onClose,
  onExitEntry = null,
  entryTitle,
}: AddRepositoryFlowPanelProps) {
  const [step, setStep] = useState<AddRepoFlowStep>({ kind: "entry" });
  // An anchored popover does not own the add-repo-flow store's completion
  // callback, so hiding it on a handoff destroys nothing: close and handoff are
  // the same motion here.
  const flow = useAddRepoFlowController({
    open: true,
    step,
    setStep,
    onClose,
    onHandoff: onClose,
  });

  return (
    <AddRepositoryPopover
      step={step}
      options={flow.options}
      adding={flow.adding}
      githubConnected={flow.githubConnected}
      entryNote={flow.entryNote}
      error={flow.error}
      cloudPicker={flow.cloudPicker}
      clonePicker={flow.clonePicker}
      onPickOption={flow.onPickOption}
      onBack={flow.onBack}
      onExitEntry={onExitEntry}
      entryTitle={entryTitle}
    />
  );
}
