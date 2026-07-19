import { Component, type ErrorInfo, type ReactNode } from "react";
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
import type { RenderErrorReport } from "@proliferate/product-client/host/desktop-bridge";

import {
  buildRenderErrorTechnicalDetails,
  formatRenderErrorDetails,
  reportStatusLabel,
  type RenderErrorReportStatus,
  type RenderErrorTechnicalDetails,
} from "#product/lib/domain/app/render-error-recovery";

export interface AppErrorBoundaryProps {
  children: ReactNode;
  /** Resolves true only after the host confirms diagnostic persistence. */
  onRenderError?: (
    report: RenderErrorReport,
  ) => boolean | Promise<boolean>;
  clientReleaseId?: string | null;
  onReload?: () => void | Promise<void>;
  onCopyDetails?: (details: string) => void | Promise<void>;
  onContactSupport?: () => void | Promise<void>;
}

interface State {
  error: Error | null;
  componentStack: string | null;
  reportResult: "reported" | "failed" | null;
  copyState: "idle" | "copied" | "failed";
  actionNotice: string | null;
}

const INITIAL_STATE: State = {
  error: null,
  componentStack: null,
  reportResult: null,
  copyState: "idle",
  actionNotice: null,
};

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

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, State> {
  state: State = INITIAL_STATE;
  private reportAttempt = 0;
  private acceptingUpdates = true;

  static getDerivedStateFromError(error: Error): State {
    return { ...INITIAL_STATE, error };
  }

  componentDidMount(): void {
    // React StrictMode simulates an unmount/remount cycle on the same instance
    // in development. Re-enable completions without invalidating the report
    // attempt that componentDidCatch already started.
    this.acceptingUpdates = true;
  }

  componentWillUnmount(): void {
    this.acceptingUpdates = false;
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const attempt = ++this.reportAttempt;
    this.setState({ componentStack: info.componentStack ?? null });

    const reporter = this.props.onRenderError;
    if (reporter) {
      try {
        void Promise.resolve(
          reporter({ error, componentStack: info.componentStack }),
        ).then(
          (reported) => this.finishReport(attempt, error, reported),
          () => this.finishReport(attempt, error, false),
        );
      } catch {
        this.finishReport(attempt, error, false);
      }
    }

    console.error("[AppErrorBoundary] Uncaught render error:", error);
    console.error("[AppErrorBoundary] Component stack:", info.componentStack);
  }

  private finishReport(attempt: number, error: Error, reported: boolean): void {
    if (
      !this.acceptingUpdates
      || attempt !== this.reportAttempt
      || this.state.error !== error
    ) {
      return;
    }
    this.setState({ reportResult: reported ? "reported" : "failed" });
  }

  private reportStatus(): RenderErrorReportStatus {
    if (this.state.reportResult) return this.state.reportResult;
    return this.props.onRenderError ? "reporting" : "unavailable";
  }

  private technicalDetails(): RenderErrorTechnicalDetails {
    return buildRenderErrorTechnicalDetails({
      error: this.state.error!,
      componentStack: this.state.componentStack,
      clientReleaseId: this.props.clientReleaseId,
    });
  }

  private handleReload = (): void => {
    try {
      const reload = this.props.onReload
        ?? (() => window.location.reload());
      void Promise.resolve(reload()).catch(() => {
        if (this.acceptingUpdates) {
          this.setState({ actionNotice: "Reload failed. Try again or copy the details." });
        }
      });
    } catch {
      this.setState({ actionNotice: "Reload failed. Try again or copy the details." });
    }
  };

  private handleTryAgain = (): void => {
    this.reportAttempt += 1;
    this.setState(INITIAL_STATE);
  };

  private handleCopyDetails = (): void => {
    const details = formatRenderErrorDetails(
      this.technicalDetails(),
      this.reportStatus(),
    );
    const copy = this.props.onCopyDetails
      ?? ((value: string) => navigator.clipboard.writeText(value));
    try {
      void Promise.resolve(copy(details)).then(
        () => {
          if (this.acceptingUpdates) {
            this.setState({ copyState: "copied", actionNotice: "Details copied." });
          }
        },
        () => {
          if (this.acceptingUpdates) {
            this.setState({ copyState: "failed", actionNotice: "Couldn't copy details." });
          }
        },
      );
    } catch {
      this.setState({ copyState: "failed", actionNotice: "Couldn't copy details." });
    }
  };

  private handleContactSupport = (): void => {
    const contact = this.props.onContactSupport;
    if (!contact) return;
    try {
      void Promise.resolve(contact()).catch(() => {
        if (this.acceptingUpdates) {
          this.setState({ actionNotice: "Couldn't open the support destination." });
        }
      });
    } catch {
      this.setState({ actionNotice: "Couldn't open the support destination." });
    }
  };

  render() {
    if (!this.state.error) return this.props.children;

    const reportStatus = this.reportStatus();
    const technicalDetails = this.technicalDetails();
    const canContactSupport = Boolean(this.props.onContactSupport);

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
              onClick={this.handleReload}
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
              onClick={this.handleTryAgain}
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
              onClick={this.handleCopyDetails}
            >
              <Copy className="size-4" aria-hidden />
              {this.state.copyState === "copied" ? "Copied" : "Copy details"}
            </Button>
            {canContactSupport ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={this.handleContactSupport}
              >
                <Mail className="size-4" aria-hidden />
                Contact support
              </Button>
            ) : null}
          </div>

          {this.state.actionNotice ? (
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {this.state.actionNotice}
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
}
