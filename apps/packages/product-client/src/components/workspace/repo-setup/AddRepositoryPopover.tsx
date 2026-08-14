import type { ReactNode } from "react";
import { ArrowLeft } from "#product/primitives/icons/core";
import { CloudIcon } from "#product/primitives/icons/platform";
import { FolderOpen } from "#product/primitives/icons/workspace";
import { GitBranch } from "#product/primitives/icons/workspace-git";

import { Button } from "#product/primitives/Button";
import { POPOVER_FRAME_CLASS } from "#product/primitives/popover-surface";
import { PopoverMenuItem } from "#product/primitives/PopoverMenuItem";
import { Spinner } from "#product/primitives/Spinner";
import type { CloudRepoPickerProps } from "#product/lib/domain/workspaces/cloud/cloud-repo-picker-view";
import type {
  AddRepoFlowOption,
  AddRepoFlowStep,
} from "#product/lib/domain/workspaces/creation/add-repo-flow-steps";
import { CloudRepoPicker } from "./CloudRepoPicker";

// The flow's vocabulary is domain-owned (the controller hook and the flow store
// both name a step), re-exported here so existing importers keep working.
export type {
  AddRepoFlowOption,
  AddRepoFlowStep,
} from "#product/lib/domain/workspaces/creation/add-repo-flow-steps";

/**
 * The flow's surface, for hosts that anchor it themselves: popover chrome at
 * the menu's own width and padding. Kept here (not at each host) so the three
 * entry points cannot render the same body at three different widths.
 */
export const ADD_REPOSITORY_SURFACE_CLASS = `w-80 p-1.5 ${POPOVER_FRAME_CLASS}`;

/** The copy the entry menu owes a user who has not connected GitHub yet. */
export const GITHUB_CONNECTION_FOOTNOTE =
  "Clone and Cloud need a one-time GitHub connection.";

export interface AddRepositoryPopoverProps {
  step: AddRepoFlowStep;
  /** Which entry options this host actually supports. Web omits the local
   * option so the flow can never offer an operation that errors at click time. */
  options: readonly AddRepoFlowOption[];
  /** True while a local add is committing (disables entry options). */
  adding?: boolean;
  /**
   * Whether the GitHub App is already authorized. When it is not, the entry
   * menu carries one footnote instead of a "Needs GitHub" badge on each row:
   * the detour is a property of the flow, not of two of the three choices.
   */
  githubConnected?: boolean;
  /**
   * Optional note under the entry options explaining what this host cannot
   * offer. Authored by the host so this component stays copy-free.
   */
  entryNote?: string | null;
  error?: string | null;
  /** View model for the cloud step, wired by the host's controller layer. */
  cloudPicker?: CloudRepoPickerProps | null;
  /** View model for the clone-from-github step, wired by the host. Reuses the
   * repo picker; on select the host runs the local clone. */
  clonePicker?: CloudRepoPickerProps | null;
  onPickOption: (option: AddRepoFlowOption) => void;
  /** Sub-step → entry. */
  onBack: () => void;
  /**
   * Leave the flow from the ENTRY step, when the flow is embedded in a surface
   * that has somewhere to go back to (the project menu's sweep). Absent when
   * the flow is the whole popover, where the entry step is the root.
   */
  onExitEntry?: (() => void) | null;
  /** Header title for the entry step; only rendered alongside `onExitEntry`. */
  entryTitle?: string;
}

interface EntryOption {
  option: AddRepoFlowOption;
  icon: ReactNode;
  label: string;
}

const ENTRY_OPTION_DEFS: Record<AddRepoFlowOption, EntryOption> = {
  "add-existing-folder": {
    option: "add-existing-folder",
    icon: <FolderOpen aria-hidden className="icon-paired" />,
    label: "Add an existing folder",
  },
  "clone-from-github": {
    option: "clone-from-github",
    icon: <GitBranch aria-hidden className="icon-paired" />,
    label: "Clone from GitHub",
  },
  cloud: {
    option: "cloud",
    icon: <CloudIcon aria-hidden className="icon-paired" />,
    label: "Set up in Cloud",
  },
};

/**
 * The guided add-repository flow, as popover content.
 *
 * Entry menu → GitHub setup checklist / waiting-on-GitHub → repo picker, all in
 * one panel. This component is the BODY only: the surface (and therefore the
 * anchor) belongs to whoever hosts it — the sidebar Repositories "+", the home
 * project menu's sweep, or the app-level flow host.
 *
 * The entry rows are flat single-line menu items. The descriptions and numbered
 * shortcut badges that used to hang off them explained the choices at the exact
 * moment the labels already did, and pushed the real work (connecting GitHub)
 * below the fold.
 */
export function AddRepositoryPopover({
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
  onExitEntry = null,
  entryTitle = "Add a repository",
}: AddRepositoryPopoverProps) {
  return (
    <div data-telemetry-block>
      {step.kind === "entry" ? (
        <AddRepoEntryStep
          options={options}
          onPickOption={onPickOption}
          disabled={adding}
          adding={adding}
          githubConnected={githubConnected}
          note={entryNote}
          onExit={onExitEntry}
          title={entryTitle}
        />
      ) : step.kind === "clone" ? (
        <AddRepoPickerStep
          title="Clone from GitHub"
          picker={clonePicker}
          onBack={onBack}
        />
      ) : (
        <AddRepoPickerStep
          title="Add a cloud repo"
          picker={cloudPicker}
          onBack={onBack}
        />
      )}
      {error ? (
        <p className="mt-2 px-2.5 pb-1 text-ui-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function AddRepoEntryStep({
  options,
  onPickOption,
  disabled = false,
  adding = false,
  githubConnected,
  note = null,
  onExit,
  title,
}: {
  options: readonly AddRepoFlowOption[];
  onPickOption: (option: AddRepoFlowOption) => void;
  disabled?: boolean;
  adding?: boolean;
  githubConnected: boolean;
  note?: string | null;
  onExit: (() => void) | null;
  title: string;
}) {
  const entries = options.map((option) => ENTRY_OPTION_DEFS[option]);

  return (
    <div>
      {onExit ? <StepHeader title={title} label="Back to projects" onBack={onExit} /> : null}
      {entries.map((entry) => (
        <PopoverMenuItem
          key={entry.option}
          icon={entry.icon}
          label={entry.label}
          disabled={disabled}
          // The native folder picker IS the confirmation, so the row itself is
          // where "adding" is legible — there is no later step to show it on.
          trailing={
            adding && entry.option === "add-existing-folder"
              ? <Spinner className="icon-paired text-muted-foreground" />
              : null
          }
          onClick={() => onPickOption(entry.option)}
        />
      ))}
      {githubConnected ? null : (
        <p className="mt-1 border-t border-border/60 px-2.5 pb-1 pt-2 text-ui-sm text-muted-foreground">
          {GITHUB_CONNECTION_FOOTNOTE}
        </p>
      )}
      {note ? (
        <p className="mt-1 border-t border-border/60 px-2.5 pb-1 pt-2 text-ui-sm text-muted-foreground">
          {note}
        </p>
      ) : null}
    </div>
  );
}

function AddRepoPickerStep({
  title,
  picker,
  onBack,
}: {
  title: string;
  picker: CloudRepoPickerProps | null;
  onBack: () => void;
}) {
  return (
    <div>
      <StepHeader title={title} label="Back" onBack={onBack} />
      {picker ? <CloudRepoPicker {...picker} /> : null}
    </div>
  );
}

/** Compact sub-step header: a ghost back control and the step's name. */
function StepHeader({
  title,
  label,
  onBack,
}: {
  title: string;
  label: string;
  onBack: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5 px-1 pb-2 pt-0.5">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="-ml-0.5 size-6 rounded-md"
        aria-label={label}
        onClick={onBack}
      >
        <ArrowLeft aria-hidden className="icon-paired" />
      </Button>
      <span className="text-ui-sm font-medium text-foreground">{title}</span>
    </div>
  );
}
