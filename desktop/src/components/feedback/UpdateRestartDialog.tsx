import { Button } from "@/components/ui/Button";
import { ModalShell } from "@/components/ui/ModalShell";
import { useUpdater } from "@/hooks/updater/use-updater";

export function UpdateRestartDialog() {
  const {
    phase,
    availableVersion,
    restartPromptOpen,
    closeRestartPrompt,
    restartNow,
  } = useUpdater();

  return (
    <ModalShell
      open={restartPromptOpen && phase === "ready"}
      onClose={closeRestartPrompt}
      title="Restart to finish updating"
      description={
        availableVersion
          ? `Version ${availableVersion} has been installed and is ready to use.`
          : "The update has been installed and is ready to use."
      }
      footer={(
        <>
          <Button variant="ghost" onClick={closeRestartPrompt}>
            Later
          </Button>
          <Button variant="primary" onClick={() => void restartNow()}>
            Restart now
          </Button>
        </>
      )}
    >
      <div className="space-y-2">
        <p className="text-sm text-foreground">
          Restarting closes Proliferate and starts the new version.
        </p>
        <p className="text-xs text-muted-foreground">
          If you have local work in progress, wait until you are ready before restarting.
        </p>
      </div>
    </ModalShell>
  );
}
