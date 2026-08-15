import { AnchoredCommandPopover } from "#product/primitives/AnchoredCommandPopover";
import type { CloudRepoPickerProps } from "#product/lib/domain/workspaces/cloud/cloud-repo-picker-view";
import {
  ADD_REPOSITORY_SURFACE_CLASS,
  AddRepositoryPopover,
  type AddRepoFlowOption,
  type AddRepoFlowStep,
} from "./AddRepositoryPopover";

export {
  ADD_REPOSITORY_SURFACE_CLASS,
  AddRepositoryPopover,
  GITHUB_CONNECTION_FOOTNOTE,
} from "./AddRepositoryPopover";
export type {
  AddRepoFlowOption,
  AddRepoFlowStep,
} from "./AddRepositoryPopover";

/** The app-level flow's surface: the same chrome the anchored hosts use. The
 * enter animation belongs to the popover primitive, not to this class. */
export const ADD_REPO_SURFACE_CLASS = ADD_REPOSITORY_SURFACE_CLASS;

/** The dialog's accessible name — there is no trigger to borrow one from. */
const ADD_REPO_DIALOG_LABEL = "Add a repository";

export interface AddRepoFlowProps {
  open: boolean;
  step: AddRepoFlowStep;
  options: readonly AddRepoFlowOption[];
  /** True while a local add is committing (disables entry options). */
  adding?: boolean;
  /** False while the GitHub App is unauthorized — shows the entry footnote. */
  githubConnected?: boolean;
  entryNote?: string | null;
  error?: string | null;
  cloudPicker?: CloudRepoPickerProps | null;
  clonePicker?: CloudRepoPickerProps | null;
  onPickOption: (option: AddRepoFlowOption) => void;
  onBack: () => void;
  onClose: () => void;
}

/**
 * The app-level (store-driven) presentation of the add-repository flow.
 *
 * A popover surface rather than the old centered Dialog: the flow is a menu of
 * choices followed by a picker, which is the product's popover language, and
 * the two anchored entry points (the sidebar "+" and the project menu's sweep)
 * host the exact same body. This one has no element to anchor to — it is raised
 * by a command, not by a control — so it hangs off a fixed anchor near the top
 * of the viewport and keeps the popover's chrome, dismissal and focus
 * neutrality.
 */
export function AddRepoFlow({
  open,
  step,
  options,
  adding = false,
  githubConnected = true,
  entryNote = null,
  error = null,
  cloudPicker = null,
  clonePicker = null,
  onPickOption,
  onBack,
  onClose,
}: AddRepoFlowProps) {
  return (
    <AnchoredCommandPopover
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onClose();
        }
      }}
      aria-label={ADD_REPO_DIALOG_LABEL}
      className={ADD_REPO_SURFACE_CLASS}
    >
      <AddRepositoryPopover
        step={step}
        options={options}
        adding={adding}
        githubConnected={githubConnected}
        entryNote={entryNote}
        error={error}
        cloudPicker={cloudPicker}
        clonePicker={clonePicker}
        onPickOption={onPickOption}
        onBack={onBack}
      />
    </AnchoredCommandPopover>
  );
}
