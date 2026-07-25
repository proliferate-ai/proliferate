import {
  Component,
  useCallback,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";

interface Props {
  children: ReactNode;
}

interface BoundaryProps extends Props {
  reportError(error: Error, componentStack?: string | null): void;
}

interface State {
  error: Error | null;
}

class ProductErrorBoundary extends Component<BoundaryProps, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.reportError(error, info.componentStack);
    console.error("[AppErrorBoundary] Uncaught render error:", error);
    console.error("[AppErrorBoundary] Component stack:", info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-background p-8 text-foreground">
          <p className="text-lg font-medium">Something went wrong</p>
          <pre className="max-w-2xl overflow-auto rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            {this.state.error.message}
          </pre>
          <Button
            type="button"
            variant="unstyled"
            size="unstyled"
            onClick={() => this.setState({ error: null })}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          >
            Try again
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}

/** Host-backed wrapper around the movable product error boundary. */
export function AppErrorBoundary({ children }: Props) {
  const { desktop, telemetry } = useProductHost();
  const diagnostics = desktop?.diagnostics ?? null;
  const reportError = useCallback(
    (error: Error, componentStack?: string | null) => {
      if (diagnostics !== null) {
        diagnostics.reportReactRenderError(error, componentStack);
        return;
      }
      telemetry.captureException(error, {
        tags: {
          action: "react_render",
          domain: "app",
        },
        extras: {
          componentStack: componentStack ?? null,
        },
      });
    },
    [diagnostics, telemetry],
  );

  return (
    <ProductErrorBoundary reportError={reportError}>
      {children}
    </ProductErrorBoundary>
  );
}
