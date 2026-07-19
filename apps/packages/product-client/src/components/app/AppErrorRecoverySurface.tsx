import { useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import {
  CheckCircleFilled,
  ChevronDown,
  CircleAlert,
  Copy,
  Mail,
  RefreshCw,
  RotateCcw,
  Spinner,
} from "@proliferate/ui/icons";
import { ProliferateIcon } from "@proliferate/ui/proliferate-icons";

import type { AppErrorBoundaryProps } from "#product/components/app/AppErrorBoundary";
import {
  buildRenderErrorTechnicalDetails,
  formatRenderErrorDetails,
  reportStatusLabel,
  type RenderErrorReportStatus,
  type RenderErrorTechnicalDetails,
} from "#product/lib/domain/app/render-error-recovery";

interface AppErrorRecoverySurfaceProps {
  error: Error;
  componentStack: string | null;
  reportStatus: RenderErrorReportStatus;
  clientReleaseId?: string | null;
  onReload?: AppErrorBoundaryProps["onReload"];
  onTryAgain: () => void;
  onCopyDetails?: AppErrorBoundaryProps["onCopyDetails"];
  onContactSupport?: AppErrorBoundaryProps["onContactSupport"];
}

function statusDescription(
  status: RenderErrorReportStatus,
  canContactSupport: boolean,
): string {
  const recoveryActions = canContactSupport
    ? "Copy the details or contact support if you need help."
    : "Copy the technical details if you need help.";
  switch (status) {
    case "reporting":
      return "Sending a diagnostic report. You can reload while this finishes.";
    case "reported":
      return "We've been notified and are investigating.";
    case "failed":
      return `We couldn't send the diagnostic report. ${recoveryActions}`;
    case "unavailable":
      return `Automatic reporting isn't available here. ${recoveryActions}`;
  }
}

function statusTone(status: RenderErrorReportStatus): string {
  if (status === "reported") return "border-success/25 bg-success/10";
  if (status === "failed") return "border-destructive/25 bg-destructive/10";
  return "border-border/70 bg-surface-elevated-secondary";
}

function ReportStatusIcon({ status }: { status: RenderErrorReportStatus }) {
  if (status === "reporting") {
    return <Spinner className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />;
  }
  if (status === "reported") {
    return <CheckCircleFilled className="mt-0.5 size-4 shrink-0 text-success" />;
  }
  return <CircleAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" />;
}

function TechnicalDetails({
  details,
  reportStatus,
}: {
  details: RenderErrorTechnicalDetails;
  reportStatus: RenderErrorReportStatus;
}) {
  return (
    <details className="group rounded-lg border border-border/60 bg-surface-elevated-secondary text-xs">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
        <span>Technical details</span>
        <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <dl className="space-y-3 border-t border-border/60 px-4 py-3 text-muted-foreground">
        <div>
          <dt className="font-medium text-foreground">Error message</dt>
          <dd className="mt-1 break-words">{details.message}</dd>
        </div>
        <div>
          <dt className="font-medium text-foreground">Component stack</dt>
          <dd>
            <pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap break-words font-mono leading-relaxed">
              {details.componentStack}
            </pre>
          </dd>
        </div>
        <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-1">
          <dt className="text-foreground">App</dt>
          <dd className="break-words">{details.identity.app}</dd>
          <dt className="text-foreground">Version</dt>
          <dd className="break-words">{details.identity.version}</dd>
          <dt className="text-foreground">Release</dt>
          <dd className="break-words">{details.identity.release}</dd>
          <dt className="text-foreground">Build</dt>
          <dd className="break-words">{details.identity.build}</dd>
          <dt className="text-foreground">Report</dt>
          <dd>{reportStatusLabel(reportStatus)}</dd>
        </div>
      </dl>
    </details>
  );
}

export function AppErrorRecoverySurface({
  error,
  componentStack,
  reportStatus,
  clientReleaseId,
  onReload,
  onTryAgain,
  onCopyDetails,
  onContactSupport,
}: AppErrorRecoverySurfaceProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const technicalDetails = buildRenderErrorTechnicalDetails({
    error,
    componentStack,
    clientReleaseId,
  });
  const canContactSupport = Boolean(onContactSupport);

  function handleReload(): void {
    const reload = onReload ?? (() => window.location.reload());
    try {
      void Promise.resolve(reload()).catch(() => {
        setActionNotice("Reload failed. Try again or copy the details.");
      });
    } catch {
      setActionNotice("Reload failed. Try again or copy the details.");
    }
  }

  function handleCopyDetails(): void {
    const details = formatRenderErrorDetails(technicalDetails, reportStatus);
    const copy = onCopyDetails
      ?? ((value: string) => navigator.clipboard.writeText(value));
    try {
      void Promise.resolve(copy(details)).then(
        () => {
          setCopyState("copied");
          setActionNotice("Details copied.");
        },
        () => {
          setCopyState("failed");
          setActionNotice("Couldn't copy details.");
        },
      );
    } catch {
      setCopyState("failed");
      setActionNotice("Couldn't copy details.");
    }
  }

  function handleContactSupport(): void {
    if (!onContactSupport) return;
    try {
      void Promise.resolve(onContactSupport()).catch(() => {
        setActionNotice("Couldn't open the support destination.");
      });
    } catch {
      setActionNotice("Couldn't open the support destination.");
    }
  }

  return (
    <main
      className="flex min-h-screen w-screen items-center justify-center overflow-auto bg-background px-6 py-12 text-foreground"
      data-crash-recovery
      data-report-status={reportStatus}
      data-tauri-drag-region="true"
    >
      <div className="w-full max-w-xl space-y-6">
        <header className="space-y-5">
          <div className="flex size-10 items-center justify-center rounded-xl border border-border/70 bg-card shadow-keystone">
            <ProliferateIcon className="size-5 text-foreground" aria-hidden />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Proliferate recovery
            </p>
            <h1 className="text-2xl font-semibold leading-tight">
              The app needs a quick reload
            </h1>
            <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">
              Sorry about that. Something unexpected interrupted this view,
              but the recovery tools below are still working.
            </p>
          </div>
        </header>

        <div
          className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${statusTone(reportStatus)}`}
          role="status"
          aria-live="polite"
        >
          <ReportStatusIcon status={reportStatus} />
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium">{reportStatusLabel(reportStatus)}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {statusDescription(reportStatus, canContactSupport)}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            size="md"
            onClick={handleReload}
            autoFocus
            className="sm:min-w-36"
          >
            <RefreshCw className="size-4" aria-hidden />
            Reload app
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onTryAgain}
            className="sm:min-w-32"
          >
            <RotateCcw className="size-4" aria-hidden />
            Try again
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleCopyDetails}
          >
            <Copy className="size-4" aria-hidden />
            {copyState === "copied" ? "Copied" : "Copy details"}
          </Button>
          {canContactSupport ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleContactSupport}
            >
              <Mail className="size-4" aria-hidden />
              Contact support
            </Button>
          ) : null}
        </div>

        {actionNotice ? (
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {actionNotice}
          </p>
        ) : null}

        <TechnicalDetails
          details={technicalDetails}
          reportStatus={reportStatus}
        />
      </div>
    </main>
  );
}
