import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { ModalShell } from "@proliferate/ui/primitives/ModalShell";
import { CONNECT_SERVER_LABELS } from "@/copy/auth/auth-copy";
import type { UseConnectServerResult } from "@/hooks/auth/workflows/use-connect-server";

interface ConnectServerDialogProps {
  controller: UseConnectServerResult;
  /**
   * Optional context line rendered above the flow body — used when the dialog
   * is opened from an invite link so the user understands why they're being
   * asked to connect to a server (see the join-invitation flow).
   */
  context?: string;
}

/**
 * Manual-entry connect-to-server dialog: URL entry -> validate
 * (`GET {url}/meta`) -> trust-confirmation -> connect (`set_app_config` +
 * relaunch). Presentational only — all flow logic lives in `useConnectServer`.
 */
export function ConnectServerDialog({ controller, context }: ConnectServerDialogProps) {
  const {
    step,
    url,
    setUrl,
    error,
    pendingHost,
    pendingMeta,
    close,
    submitUrl,
    confirmConnect,
    versionWarning,
  } = controller;

  const open = step !== "closed";
  const busy = step === "checking" || step === "connecting";
  const showEntry = step === "entry" || step === "checking";
  const showTrustConfirm = step === "trust-confirm" || (step === "connecting" && pendingHost !== null);

  return (
    <ModalShell
      open={open}
      onClose={close}
      disableClose={busy}
      title={CONNECT_SERVER_LABELS.dialogTitle}
      sizeClassName="max-w-sm"
      footer={showTrustConfirm ? (
        <>
          <Button type="button" variant="ghost" size="md" disabled={busy} onClick={close}>
            {CONNECT_SERVER_LABELS.cancel}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            loading={step === "connecting"}
            disabled={busy}
            onClick={() => void confirmConnect()}
          >
            {step === "connecting" ? CONNECT_SERVER_LABELS.connecting : CONNECT_SERVER_LABELS.connect}
          </Button>
        </>
      ) : (
        <>
          <Button type="button" variant="ghost" size="md" disabled={busy} onClick={close}>
            {CONNECT_SERVER_LABELS.cancel}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            loading={step === "checking"}
            disabled={busy || url.trim().length === 0}
            onClick={() => void submitUrl()}
          >
            {step === "checking" ? CONNECT_SERVER_LABELS.checking : CONNECT_SERVER_LABELS.continue}
          </Button>
        </>
      )}
    >
      {showEntry ? (
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submitUrl();
          }}
        >
          {context ? (
            <p className="text-sm text-foreground">{context}</p>
          ) : null}
          <p className="text-sm text-muted-foreground">
            {CONNECT_SERVER_LABELS.entryDescription}
          </p>
          <Input
            type="text"
            autoFocus
            autoComplete="url"
            placeholder={CONNECT_SERVER_LABELS.addressFieldPlaceholder}
            aria-label={CONNECT_SERVER_LABELS.addressFieldLabel}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            disabled={busy}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
      ) : (
        <div className="grid gap-2">
          {context ? (
            <p className="text-sm text-muted-foreground">{context}</p>
          ) : null}
          <p className="text-sm text-foreground">
            {pendingHost ? CONNECT_SERVER_LABELS.trustDescription(pendingHost) : null}
          </p>
          {pendingMeta && (
            <p className="text-xs text-muted-foreground">
              {CONNECT_SERVER_LABELS.serverVersionLabel(pendingMeta.serverVersion)}
            </p>
          )}
          {versionWarning ? (
            <p className="text-xs text-warning">{versionWarning}</p>
          ) : null}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      )}
    </ModalShell>
  );
}
