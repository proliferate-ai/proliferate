import { useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Spinner } from "@proliferate/ui/icons";

import type { AppErrorBoundaryProps } from "#product/components/app/AppErrorBoundary";
import {
  buildRenderErrorTechnicalDetails,
  formatRenderErrorDetails,
  reportStatusLabel,
  type RenderErrorReportStatus,
  type RenderErrorTechnicalDetails,
} from "#product/lib/domain/app/render-error-recovery";

interface AppErrorRecoverySurfaceProps {
  error: unknown;
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
      return "sending a diagnostic report. You can reload while this finishes.";
    case "reported":
      return "we've been notified and are investigating.";
    case "failed":
      return `we couldn't send the diagnostic report. ${recoveryActions}`;
    case "unavailable":
      return `automatic reporting isn't available here. ${recoveryActions}`;
  }
}

function statusLead(status: RenderErrorReportStatus): string {
  switch (status) {
    case "reporting":
      return "Reporting";
    case "reported":
      return "Reported";
    case "failed":
      return "Report failed";
    case "unavailable":
      return "Reporting unavailable";
  }
}

function TechnicalDetails({
  details,
  reportStatus,
}: {
  details: RenderErrorTechnicalDetails;
  reportStatus: RenderErrorReportStatus;
}) {
  return (
    <details className="border-t border-border/50 pt-3 text-xs text-muted-foreground">
      <summary className="w-fit cursor-pointer rounded-sm py-1 pr-1 text-xs outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
        Technical details
      </summary>
      <dl className="mt-3 space-y-3 border-l border-border/50 pl-3 text-[11px] leading-relaxed">
        <div>
          <dt className="font-medium text-foreground/90">Error message</dt>
          <dd className="mt-1 break-words">{details.message}</dd>
        </div>
        <div>
          <dt className="font-medium text-foreground/90">Component stack</dt>
          <dd>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
              {details.componentStack}
            </pre>
          </dd>
        </div>
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
          <dt className="text-foreground/90">App</dt>
          <dd className="break-words">{details.identity.app}</dd>
          <dt className="text-foreground/90">Version</dt>
          <dd className="break-words">{details.identity.version}</dd>
          <dt className="text-foreground/90">Release</dt>
          <dd className="break-words">{details.identity.release}</dd>
          <dt className="text-foreground/90">Build</dt>
          <dd className="break-words">{details.identity.build}</dd>
          <dt className="text-foreground/90">Report</dt>
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
      className="flex min-h-screen w-screen items-center justify-center overflow-auto bg-background px-6 py-8 text-foreground"
      data-crash-recovery
      data-report-status={reportStatus}
      data-tauri-drag-region="true"
    >
      <div className="w-full max-w-lg space-y-5">
        <header className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Proliferate recovery
          </p>
          <h1 className="text-2xl font-semibold leading-tight tracking-tight">
            The app needs a quick reload
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Sorry about that. Something unexpected interrupted this view, but
            the recovery tools are still available.
          </p>
        </header>

        <div
          className="flex min-h-5 items-start gap-2 text-sm leading-relaxed"
          role="status"
          aria-live="polite"
          data-report-appearance="neutral"
        >
          {reportStatus === "reporting" ? (
            <Spinner className="mt-0.5 size-3.5 shrink-0 animate-spin text-muted-foreground" />
          ) : null}
          <p className="min-w-0">
            <span className="font-medium text-foreground">
              {statusLead(reportStatus)}
            </span>
            <span className="text-muted-foreground">
              {` — ${statusDescription(reportStatus, canContactSupport)}`}
            </span>
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" size="md" onClick={handleReload} autoFocus>
            Reload app
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onTryAgain}
          >
            Try again
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button
            type="button"
            variant="unstyled"
            size="unstyled"
            onClick={handleCopyDetails}
            className="rounded-sm text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {copyState === "copied" ? "Copied" : "Copy details"}
          </Button>
          {canContactSupport ? (
            <Button
              type="button"
              variant="unstyled"
              size="unstyled"
              onClick={handleContactSupport}
              className="rounded-sm text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Contact support
            </Button>
          ) : null}
        </div>

        {actionNotice ? (
          <p className="-mt-2 text-xs text-muted-foreground" aria-live="polite">
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
