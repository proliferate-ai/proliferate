import { Button } from "@proliferate/ui/primitives/Button";
import { Checkbox } from "@proliferate/ui/primitives/Checkbox";
import { Label } from "@proliferate/ui/primitives/Label";
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
  const outClause = availableVersion
    ? `Proliferate ${availableVersion} is out`
    : "A new version of Proliferate is out";
  const currentClause = availableVersion && currentVersion
    ? ` — you're on ${currentVersion}`
    : "";

  return (
    <div className="flex h-full flex-col gap-5 px-6 pb-5 pt-4">
      <div className="flex items-start gap-4">
        <div className="flex size-14 shrink-0 items-center justify-center rounded-[22%] border border-border/60 bg-foreground/5">
          <ProliferateIcon className="size-8 text-foreground" />
        </div>
        <div className="min-w-0 pt-0.5">
          <h2 className="text-[15px] font-semibold leading-6 text-foreground">
            Update available
          </h2>
          <p className="mt-1 text-ui leading-5 text-muted-foreground">
            {`${outClause}${currentClause}. Download in the background and keep working.`}
          </p>
        </div>
      </div>

      <Label className="mb-0 flex select-none items-center gap-2 pl-[4.5rem] text-ui">
        <Checkbox
          checked={autoUpdate}
          onCheckedChange={(checked) => onToggleAutoUpdate(checked === true)}
        />
        Keep Proliferate up to date automatically
      </Label>

      <div className="mt-auto flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={onSkip}>
          Skip this version
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={onRemindLater}>
            Later
          </Button>
          <Button variant="primary" size="sm" onClick={onInstall}>
            Install update
          </Button>
        </div>
      </div>
    </div>
  );
}
