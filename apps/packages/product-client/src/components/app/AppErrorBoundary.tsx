import {
  Component,
  lazy,
  Suspense,
  type ErrorInfo,
  type ReactNode,
} from "react";
import type { RenderErrorReport } from "@proliferate/product-client/host/desktop-bridge";
import { Button } from "@proliferate/ui/primitives/Button";

import type { RenderErrorReportStatus } from "#product/lib/domain/app/render-error-recovery";

const AppErrorRecoverySurface = lazy(async () => {
  if (
    import.meta.env.DEV
    && window.location.pathname === "/playground/crash-recovery"
  ) {
    const proofState = new URLSearchParams(window.location.search).get(
      "recovery-enhancement",
    );
    if (proofState === "pending") await new Promise<never>(() => {});
    if (proofState === "rejected") throw new Error("Recovery enhancement proof rejection");
  }
  const module = await import("#product/components/app/AppErrorRecoverySurface");
  return { default: module.AppErrorRecoverySurface };
});

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
  hasError: boolean;
  error: unknown;
  componentStack: string | null;
  reportResult: "reported" | "failed" | null;
}

const INITIAL_STATE: State = {
  hasError: false,
  error: null,
  componentStack: null,
  reportResult: null,
};

interface EmergencyRecoveryShellProps {
  enhancementStatus: "loading" | "unavailable";
  reportStatus: RenderErrorReportStatus;
  onReload?: AppErrorBoundaryProps["onReload"];
  onTryAgain: () => void;
}

function emergencyReportCopy(status: RenderErrorReportStatus): string {
  switch (status) {
    case "reporting":
      return "Sending a diagnostic report…";
    case "reported":
      return "Reported — we've been notified and are investigating.";
    case "failed":
      return "Report failed — we couldn't send the diagnostic report.";
    case "unavailable":
      return "Reporting unavailable — automatic reporting isn't available here.";
  }
}

function EmergencyRecoveryShell({
  enhancementStatus,
  reportStatus,
  onReload,
  onTryAgain,
}: EmergencyRecoveryShellProps) {
  function handleReload(): void {
    try {
      void Promise.resolve(
        onReload ? onReload() : window.location.reload(),
      ).catch(() => {});
    } catch {
      // The emergency shell must remain available even if reload integration fails.
    }
  }

  return (
    <main
      className="flex min-h-screen w-screen items-center justify-center bg-background px-6 text-foreground"
      data-crash-recovery
      data-recovery-enhancement-status={enhancementStatus}
      data-report-status={reportStatus}
    >
      <div className="w-full max-w-lg space-y-4">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Proliferate recovery
        </p>
        <h1 className="text-[length:var(--text-title)] font-semibold leading-[var(--text-title--line-height)]">The app needs a quick reload</h1>
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {emergencyReportCopy(reportStatus)}
          {enhancementStatus === "loading"
            ? " Loading the remaining recovery tools…"
            : " The remaining recovery tools couldn't load."}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            onClick={handleReload}
            autoFocus
            size="md"
          >
            Reload app
          </Button>
          <Button
            type="button"
            onClick={onTryAgain}
            variant="secondary"
            size="md"
          >
            Try again
          </Button>
        </div>
      </div>
    </main>
  );
}

interface RecoveryEnhancementBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
}

class RecoveryEnhancementBoundary extends Component<
  RecoveryEnhancementBoundaryProps,
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, State> {
  state: State = INITIAL_STATE;
  private reportAttempt = 0;
  private acceptingUpdates = true;

  static getDerivedStateFromError(error: unknown): State {
    return { ...INITIAL_STATE, hasError: true, error };
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

  componentDidCatch(error: unknown, info: ErrorInfo): void {
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

    // Do not inspect or stringify an arbitrary thrown value here. The lazy
    // recovery projection normalizes it without invoking hostile accessors.
    console.error("[AppErrorBoundary] Uncaught render error captured");
    console.error("[AppErrorBoundary] Component stack:", info.componentStack);
  }

  private finishReport(attempt: number, error: unknown, reported: boolean): void {
    if (
      !this.acceptingUpdates
      || attempt !== this.reportAttempt
      || !Object.is(this.state.error, error)
    ) {
      return;
    }
    this.setState({ reportResult: reported ? "reported" : "failed" });
  }

  private reportStatus(): RenderErrorReportStatus {
    if (this.state.reportResult) return this.state.reportResult;
    return this.props.onRenderError ? "reporting" : "unavailable";
  }

  private handleTryAgain = (): void => {
    this.reportAttempt += 1;
    this.setState(INITIAL_STATE);
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const reportStatus = this.reportStatus();
    const loadingFallback = (
      <EmergencyRecoveryShell
        enhancementStatus="loading"
        reportStatus={reportStatus}
        onReload={this.props.onReload}
        onTryAgain={this.handleTryAgain}
      />
    );
    const unavailableFallback = (
      <EmergencyRecoveryShell
        enhancementStatus="unavailable"
        reportStatus={reportStatus}
        onReload={this.props.onReload}
        onTryAgain={this.handleTryAgain}
      />
    );
    return (
      <RecoveryEnhancementBoundary fallback={unavailableFallback}>
        <Suspense fallback={loadingFallback}>
          <AppErrorRecoverySurface
            error={this.state.error}
            componentStack={this.state.componentStack}
            reportStatus={reportStatus}
            clientReleaseId={this.props.clientReleaseId}
            onReload={this.props.onReload}
            onTryAgain={this.handleTryAgain}
            onCopyDetails={this.props.onCopyDetails}
            onContactSupport={this.props.onContactSupport}
          />
        </Suspense>
      </RecoveryEnhancementBoundary>
    );
  }
}
