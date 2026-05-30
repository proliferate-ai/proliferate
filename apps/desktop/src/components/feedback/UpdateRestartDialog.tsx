import { Button } from "@proliferate/ui/primitives/Button";
import { ModalShell } from "@proliferate/ui/primitives/ModalShell";
import { useUpdater } from "@/hooks/access/tauri/use-updater";

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
      showCloseButton={false}
      sizeClassName="max-w-[420px]"
      overlayClassName="bg-black/70"
      panelClassName="!rounded-lg border-border/80 bg-card shadow-floating-dark"
      bodyClassName="px-5 pb-0 pt-0"
      footerClassName="flex shrink-0 items-center justify-end gap-2 px-5 pb-4 pt-5"
      headerContent={(
        <div>
          <h2 className="text-base font-medium leading-6 text-foreground">
            Restart to finish updating
          </h2>
          <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
            {availableVersion
              ? `Proliferate ${availableVersion} is installed and ready.`
              : "Proliferate is installed and ready."}
          </p>
        </div>
      )}
      footer={(
        <>
          <Button
            variant="ghost"
            size="sm"
            className="h-[34px] px-3.5 text-[13px]"
            onClick={closeRestartPrompt}
          >
            Later
          </Button>
          <Button
            variant="primary"
            size="sm"
            className="h-[34px] px-4 text-[13px]"
            onClick={() => void restartNow()}
          >
            Restart now
          </Button>
        </>
      )}
    >
      <p className="text-[13px] leading-[1.55] text-muted-foreground">
        Restarting closes Proliferate and reopens on the new version. Anything running locally
        will stop, so finish in-progress work first.
      </p>
    </ModalShell>
  );
}
