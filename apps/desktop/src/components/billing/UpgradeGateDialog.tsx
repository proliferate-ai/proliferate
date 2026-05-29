import type { ReactNode } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ModalShell } from "@proliferate/ui/primitives/ModalShell";
import { Check } from "@proliferate/ui/icons";
import type { UpgradeGateCopy } from "@/copy/billing/upgrade-gate-copy";

interface UpgradeGateDialogProps {
  open: boolean;
  copy: UpgradeGateCopy;
  contextLabel?: string;
  contextValue?: ReactNode;
  loading?: boolean;
  error?: ReactNode;
  onClose: () => void;
  onConfirm: () => void;
}

export function UpgradeGateDialog({
  open,
  copy,
  contextLabel,
  contextValue,
  loading = false,
  error,
  onClose,
  onConfirm,
}: UpgradeGateDialogProps) {
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      disableClose={loading}
      title={copy.title}
      description={copy.description}
      sizeClassName="max-w-lg"
      overlayClassName="bg-background/70 backdrop-blur-[2px]"
      panelClassName="border-border/70 bg-background/95 shadow-floating"
      footer={(
        <>
          <Button type="button" variant="ghost" size="md" disabled={loading} onClick={onClose}>
            {copy.cancelLabel}
          </Button>
          <Button type="button" variant="primary" size="md" loading={loading} onClick={onConfirm}>
            {copy.confirmLabel}
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        {contextLabel && contextValue ? (
          <div className="rounded-lg border border-border-light bg-foreground/5 px-3 py-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {contextLabel}
            </div>
            <div className="mt-1 text-sm font-medium text-foreground">{contextValue}</div>
          </div>
        ) : null}

        <div className="space-y-3">
          <div className="text-sm font-medium text-foreground">{copy.benefitsTitle}</div>
          <ul className="space-y-2">
            {copy.benefits.map((benefit) => (
              <li key={benefit} className="flex gap-2 text-sm leading-5 text-muted-foreground">
                <Check className="mt-0.5 size-4 shrink-0 text-success" />
                <span>{benefit}</span>
              </li>
            ))}
          </ul>
        </div>

        {copy.footnote ? (
          <p className="rounded-lg border border-border-light bg-foreground/5 px-3 py-2 text-xs leading-5 text-muted-foreground">
            {copy.footnote}
          </p>
        ) : null}

        {error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}
      </div>
    </ModalShell>
  );
}
