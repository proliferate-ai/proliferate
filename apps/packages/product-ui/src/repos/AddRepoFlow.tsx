import {
  useCallback,
  useEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { ArrowLeft, Cloud, FolderOpen, Link2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@proliferate/ui/kit/Dialog";
import { Button } from "@proliferate/ui/primitives/Button";
import { Label } from "@proliferate/ui/primitives/Label";
import { Switch } from "@proliferate/ui/primitives/Switch";
import { CloudRepoPicker, type CloudRepoPickerProps } from "./CloudRepoPicker";

/** Which of the three entry options was picked. */
export type AddRepoFlowOption = "link-local" | "cloud" | "add-local";

export type AddRepoFlowStep =
  | { kind: "entry" }
  | { kind: "cloud" }
  | {
    kind: "confirm-local";
    path: string;
    /** Hidden entirely when the org has no cloud configured. */
    canCreateCloudEnvironment: boolean;
  };

export interface AddRepoFlowProps {
  open: boolean;
  step: AddRepoFlowStep;
  /** True while the local confirm step is committing. */
  confirming?: boolean;
  error?: string | null;
  /** View model for the cloud step, wired by the host's controller layer. */
  cloudPicker?: CloudRepoPickerProps | null;
  onPickOption: (option: AddRepoFlowOption) => void;
  onConfirmLocal: (options: { createCloudEnvironment: boolean }) => void;
  onBack: () => void;
  onClose: () => void;
}

interface EntryOption {
  option: AddRepoFlowOption;
  icon: ReactNode;
  label: string;
  description: string;
}

const ENTRY_OPTIONS: EntryOption[] = [
  {
    option: "link-local",
    icon: <Link2 size={16} aria-hidden />,
    label: "Link a local repo",
    description: "Point Proliferate at an existing Git checkout on this machine.",
  },
  {
    option: "cloud",
    icon: <Cloud size={16} aria-hidden />,
    label: "Add a cloud repo",
    description: "Pick a GitHub repository to run in your cloud sandbox.",
  },
  {
    option: "add-local",
    icon: <FolderOpen size={16} aria-hidden />,
    label: "Add a local repo",
    description: "Register a repository folder, optionally mirrored to cloud.",
  },
];

/**
 * Unified add-repository flow (UX_SPEC §4). Entry = three options; local
 * options confirm the picked path and offer the cloud-sandbox mirror prompt;
 * the cloud option runs the authorize → pick → create sequence in place via
 * CloudRepoPicker, driven by the host's cloudPicker view model.
 */
export function AddRepoFlow({
  open,
  step,
  confirming = false,
  error = null,
  cloudPicker = null,
  onPickOption,
  onConfirmLocal,
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
          <AddRepoEntryStep onPickOption={onPickOption} />
        ) : step.kind === "cloud" ? (
          <AddRepoCloudStep cloudPicker={cloudPicker} onBack={onBack} />
        ) : (
          <AddRepoConfirmLocalStep
            path={step.path}
            canCreateCloudEnvironment={step.canCreateCloudEnvironment}
            confirming={confirming}
            onConfirm={onConfirmLocal}
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
  onPickOption,
}: {
  onPickOption: (option: AddRepoFlowOption) => void;
}) {
  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const index = Number.parseInt(event.key, 10) - 1;
    const entry = ENTRY_OPTIONS[index];
    if (entry) {
      event.preventDefault();
      onPickOption(entry.option);
    }
  }, [onPickOption]);

  return (
    <div onKeyDown={handleKeyDown}>
      <DialogHeader>
        <DialogTitle className="text-[15px] font-semibold leading-5">
          Add a repository
        </DialogTitle>
      </DialogHeader>
      <div className="mt-3">
        {ENTRY_OPTIONS.map((entry, index) => (
          <Button
            key={entry.option}
            type="button"
            variant="unstyled"
            size="unstyled"
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

function AddRepoCloudStep({
  cloudPicker,
  onBack,
}: {
  cloudPicker: CloudRepoPickerProps | null;
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
            Add a cloud repo
          </DialogTitle>
        </div>
      </DialogHeader>
      {cloudPicker ? (
        <div className="mt-3">
          <CloudRepoPicker {...cloudPicker} />
        </div>
      ) : null}
    </div>
  );
}

function AddRepoConfirmLocalStep({
  path,
  canCreateCloudEnvironment,
  confirming,
  onConfirm,
  onBack,
}: {
  path: string;
  canCreateCloudEnvironment: boolean;
  confirming: boolean;
  onConfirm: (options: { createCloudEnvironment: boolean }) => void;
  onBack: () => void;
}) {
  const [createCloudEnvironment, setCreateCloudEnvironment] = useState(
    canCreateCloudEnvironment,
  );

  useEffect(() => {
    setCreateCloudEnvironment(canCreateCloudEnvironment);
  }, [canCreateCloudEnvironment, path]);

  return (
    <div>
      <DialogHeader>
        <DialogTitle className="text-[15px] font-semibold leading-5">
          Add this repository?
        </DialogTitle>
      </DialogHeader>
      <div className="mt-3 rounded-lg bg-surface-control px-3 py-2 font-mono text-xs leading-5 text-foreground break-all">
        {path}
      </div>
      {canCreateCloudEnvironment ? (
        <Label className="mt-3 mb-0 flex items-center justify-between gap-3 rounded-lg border border-border bg-accent/50 px-3 py-2.5 text-ui text-foreground">
          <span className="min-w-0">
            <span className="block text-ui font-medium leading-5 text-foreground">
              Also create this repo in your cloud sandbox?
            </span>
            <span className="block text-xs leading-[1.45] text-muted-foreground">
              Keeps a cloud environment configured for this repository.
            </span>
          </span>
          <Switch
            checked={createCloudEnvironment}
            onChange={setCreateCloudEnvironment}
            size="compact"
            aria-label="Also create this repo in your cloud sandbox"
          />
        </Label>
      ) : null}
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" size="md" onClick={onBack} disabled={confirming}>
          Back
        </Button>
        <Button
          type="button"
          variant="primary"
          size="md"
          loading={confirming}
          onClick={() => onConfirm({ createCloudEnvironment })}
        >
          Add repository
        </Button>
      </div>
    </div>
  );
}
