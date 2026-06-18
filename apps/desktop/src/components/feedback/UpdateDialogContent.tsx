import { Button } from "@proliferate/ui/primitives/Button";
import { Checkbox } from "@proliferate/ui/primitives/Checkbox";
import { ProliferateIcon } from "@proliferate/ui/proliferate-icons";

export interface UpdateDialogContentProps {
  availableVersion: string | null;
  currentVersion: string | null;
  autoUpdate: boolean;
  onToggleAutoUpdate: (next: boolean) => void;
  onSkip: () => void;
  onRemindLater: () => void;
  onInstall: () => void;
}

/**
 * Presentational body of the "update available" prompt. Layout-only so it can be hosted
 * either inside the standalone `?update=1` OS window or in a preview frame — no ModalShell,
 * no portal. The window/host owns the chrome; this owns the content.
 */
export function UpdateDialogContent({
  availableVersion,
  currentVersion,
  autoUpdate,
  onToggleAutoUpdate,
  onSkip,
  onRemindLater,
  onInstall,
}: UpdateDialogContentProps) {
  const newVersion = availableVersion ? `Proliferate ${availableVersion}` : "A new version";
  const haveClause = currentVersion ? `—you have ${currentVersion}` : "";

  return (
    <div className="flex h-full flex-col gap-5 px-6 pb-5 pt-4">
      <div className="flex items-start gap-4">
        <div className="flex size-14 shrink-0 items-center justify-center rounded-[22%] border border-border/60 bg-foreground/5">
          <ProliferateIcon className="size-8 text-foreground" />
        </div>
        <div className="min-w-0 pt-0.5">
          <h2 className="text-[15px] font-semibold leading-6 text-foreground">
            A new version of Proliferate is available!
          </h2>
          <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
            {`${newVersion} is now available${haveClause}. Would you like to download it now?`}
          </p>
        </div>
      </div>

      <label className="flex select-none items-center gap-2 pl-[4.5rem] text-[13px] text-muted-foreground">
        <Checkbox
          checked={autoUpdate}
          onChange={(event) => onToggleAutoUpdate(event.target.checked)}
          className="size-4"
        />
        Automatically download and install updates in the future
      </label>

      <div className="mt-auto flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={onSkip}>
          Skip This Version
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={onRemindLater}>
            Remind Me Later
          </Button>
          <Button variant="primary" size="sm" onClick={onInstall}>
            Install Update
          </Button>
        </div>
      </div>
    </div>
  );
}
