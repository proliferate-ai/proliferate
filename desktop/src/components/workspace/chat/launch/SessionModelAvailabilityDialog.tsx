import { Button } from "@/components/ui/Button";
import { ModalShell } from "@/components/ui/ModalShell";
import { useSessionModelAvailabilityWorkflow } from "@/hooks/sessions/use-session-model-availability-workflow";
import type { ModelLaunchRemediationKind } from "@anyharness/sdk";

function primaryActionLabel(kind: ModelLaunchRemediationKind): string {
  switch (kind) {
    case "managed_reinstall":
      return "Update & Retry";
    case "restart":
      return "Restart & Retry";
    case "external_update":
      return "Open Agent Settings";
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function defaultRemediationMessage(providerDisplayName: string): string {
  return `Update ${providerDisplayName} tools manually, or continue with the current exposed model.`;
}

export function SessionModelAvailabilityDialog() {
  const {
    cancel,
    pausedLaunch,
    runPrimaryAction,
    useCurrentModel,
  } = useSessionModelAvailabilityWorkflow();

  if (!pausedLaunch) {
    return null;
  }

  const remediationMessage = pausedLaunch.remediation?.message.trim()
    || defaultRemediationMessage(pausedLaunch.providerDisplayName);
  const primaryLabel = pausedLaunch.remediation
    ? primaryActionLabel(pausedLaunch.remediation.kind)
    : null;

  return (
    <ModalShell
      open
      onClose={cancel}
      title={`${pausedLaunch.requestedModelDisplayName} is not exposed yet`}
      description={`${pausedLaunch.providerDisplayName} did not expose the selected model in this session.`}
      sizeClassName="max-w-lg"
      overlayClassName="bg-background/65 backdrop-blur-[3px]"
      panelClassName="border-border/70 bg-background/95 shadow-floating"
      footer={(
        <>
          <Button type="button" variant="ghost" size="md" onClick={cancel}>
            Cancel
          </Button>
          <Button type="button" variant="secondary" size="md" onClick={useCurrentModel}>
            Use Current Model
          </Button>
          {primaryLabel && (
            <Button type="button" variant="primary" size="md" onClick={runPrimaryAction}>
              {primaryLabel}
            </Button>
          )}
        </>
      )}
    >
      <div className="space-y-4 text-sm leading-6 text-foreground">
        <p>
          {pausedLaunch.requestedModelDisplayName}
          {" is supported by Proliferate for "}
          {pausedLaunch.providerDisplayName}
          {", but your installed "}
          {pausedLaunch.providerDisplayName}
          {" tools do not expose it yet."}
        </p>
        <p className="text-muted-foreground">
          {remediationMessage}
        </p>
        <div className="rounded-lg bg-foreground/5 px-3 py-2 text-xs text-muted-foreground">
          Current exposed model:
          {" "}
          <span className="font-medium text-foreground">
            {pausedLaunch.currentModelDisplayName}
          </span>
        </div>
      </div>
    </ModalShell>
  );
}
