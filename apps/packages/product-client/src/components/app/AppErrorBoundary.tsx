import {
  Component,
  lazy,
  Suspense,
  type ErrorInfo,
  type ReactNode,
} from "react";
import type { RenderErrorReport } from "@proliferate/product-client/host/desktop-bridge";

import type { RenderErrorReportStatus } from "#product/lib/domain/app/render-error-recovery";

const AppErrorRecoverySurface = lazy(async () => {
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
  error: Error | null;
  componentStack: string | null;
  reportResult: "reported" | "failed" | null;
}

const INITIAL_STATE: State = {
  error: null,
  componentStack: null,
  reportResult: null,
};

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

  private handleTryAgain = (): void => {
    this.reportAttempt += 1;
    this.setState(INITIAL_STATE);
  };

  render() {
    if (!this.state.error) return this.props.children;

    const reportStatus = this.reportStatus();
    return (
      <Suspense
        fallback={(
          <main
            className="flex min-h-screen w-screen items-center justify-center bg-background px-6 text-foreground"
            data-crash-recovery
            data-report-status={reportStatus}
          >
            <p className="text-sm text-muted-foreground">Loading recovery tools…</p>
          </main>
        )}
      >
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
    );
  }
}
