import {
  useCallback,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { ArrowLeft, Cloud, FolderOpen, GitBranch } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@proliferate/ui/kit/Dialog";
import { Button } from "@proliferate/ui/primitives/Button";
import { CloudRepoPicker, type CloudRepoPickerProps } from "./CloudRepoPicker";

/**
 * The host-truthful entry choices. `add-existing-folder` registers an existing
 * checkout on this machine (Desktop only); `clone-from-github` clones an
 * authorized GitHub repository to this machine (Desktop only, GitHub-App-ready);
 * `cloud` walks the readiness → repo picker → authority → save sequence (both
 * hosts).
 */
export type AddRepoFlowOption = "add-existing-folder" | "clone-from-github" | "cloud";

export type AddRepoFlowStep =
  | { kind: "entry" }
  | { kind: "cloud" }
  | { kind: "clone" };

export interface AddRepoFlowProps {
  open: boolean;
  step: AddRepoFlowStep;
  /** Which entry options this host actually supports. Web omits the local
   * option so the flow can never offer an operation that errors at click time. */
  options: readonly AddRepoFlowOption[];
  /** True while a local add is committing (disables entry options). */
  adding?: boolean;
  error?: string | null;
  /** View model for the cloud step, wired by the host's controller layer. */
  cloudPicker?: CloudRepoPickerProps | null;
  /** View model for the clone-from-github step, wired by the host. Reuses the
   * repo picker; on select the host runs the local clone. */
  clonePicker?: CloudRepoPickerProps | null;
  onPickOption: (option: AddRepoFlowOption) => void;
  onBack: () => void;
  onClose: () => void;
}

interface EntryOption {
  option: AddRepoFlowOption;
  icon: ReactNode;
  label: string;
  description: string;
}

const ENTRY_OPTION_DEFS: Record<AddRepoFlowOption, EntryOption> = {
  "add-existing-folder": {
    option: "add-existing-folder",
    icon: <FolderOpen size={16} aria-hidden />,
    label: "Add an existing folder",
    description: "Register a repository folder from this machine.",
  },
  "clone-from-github": {
    option: "clone-from-github",
    icon: <GitBranch size={16} aria-hidden />,
    label: "Clone from GitHub",
    description: "Clone an authorized GitHub repository to this machine.",
  },
  cloud: {
    option: "cloud",
    icon: <Cloud size={16} aria-hidden />,
    label: "Set up in Cloud",
    description: "Pick a GitHub repository to run in Proliferate Cloud.",
  },
};

/**
 * Unified add-repository flow. Entry shows only the host-supported choices
 * (Desktop: add-existing-folder + cloud; Web: cloud only); the cloud option
 * runs the readiness → pick → authority → save sequence in place via
 * CloudRepoPicker, driven by the host's cloudPicker view model.
 */
export function AddRepoFlow({
  open,
  step,
  options,
  adding = false,
  error = null,
  cloudPicker = null,
  clonePicker = null,
  onPickOption,
  onBack,
  onClose,
}: AddRepoFlowProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onClose();
        }
      }}
    >
      <DialogContent
        // Standard modal scrim (ModalShell recipe) so the dialog reads as an
        // overlay against the workspace, not a floating card.
        overlayClassName="bg-black/70 backdrop-blur-sm"
        className="max-w-[440px] rounded-xl p-4"
        data-telemetry-block
      >
        {step.kind === "entry" ? (
          <AddRepoEntryStep options={options} onPickOption={onPickOption} disabled={adding} />
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
          <p className="mt-3 text-xs leading-[1.45] text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function AddRepoEntryStep({
  options,
  onPickOption,
  disabled = false,
}: {
  options: readonly AddRepoFlowOption[];
  onPickOption: (option: AddRepoFlowOption) => void;
  disabled?: boolean;
}) {
  const entries = options.map((option) => ENTRY_OPTION_DEFS[option]);
  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const index = Number.parseInt(event.key, 10) - 1;
    const entry = entries[index];
    if (entry) {
      event.preventDefault();
      onPickOption(entry.option);
    }
  }, [disabled, entries, onPickOption]);

  return (
    <div onKeyDown={handleKeyDown}>
      <DialogHeader>
        <DialogTitle className="text-[15px] font-semibold leading-5">
          Add a repository
        </DialogTitle>
      </DialogHeader>
      <div className="mt-3">
        {entries.map((entry, index) => (
          <Button
            key={entry.option}
            type="button"
            variant="unstyled"
            size="unstyled"
            disabled={disabled}
            onClick={() => onPickOption(entry.option)}
            className={`flex w-full items-center justify-start gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none ${
              index > 0 ? "border-t border-border/60" : ""
            }`}
          >
            <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
              {entry.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-ui font-medium leading-5 text-foreground">
                {entry.label}
              </span>
              <span className="block truncate text-xs leading-[1.45] text-muted-foreground">
                {entry.description}
              </span>
            </span>
            <kbd
              aria-hidden
              className="flex size-6 shrink-0 items-center justify-center rounded-[3px] bg-surface-control font-mono text-xs text-muted-foreground/70"
            >
              {index + 1}
            </kbd>
          </Button>
        ))}
      </div>
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
      <DialogHeader>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="-ml-1 size-6 rounded-md"
            aria-label="Back"
            onClick={onBack}
          >
            <ArrowLeft size={14} aria-hidden />
          </Button>
          <DialogTitle className="text-[15px] font-semibold leading-5">
            {title}
          </DialogTitle>
        </div>
      </DialogHeader>
      {picker ? (
        <div className="mt-3">
          <CloudRepoPicker {...picker} />
        </div>
      ) : null}
    </div>
  );
}

