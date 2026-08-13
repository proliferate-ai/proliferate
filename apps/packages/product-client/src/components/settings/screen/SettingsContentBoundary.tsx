import React, { type ErrorInfo, type ReactNode } from "react";
import type { ErrorContext } from "@proliferate/product-client/host/product-host";
import { SETTINGS_COPY } from "#product/copy/settings/settings-copy";
import type { SettingsSection } from "#product/config/settings";
import { useProductTelemetry } from "#product/hooks/telemetry/facade/use-product-telemetry";
import { Button } from "#product/primitives/Button";
import { Disclosure } from "#product/primitives/patterns/Disclosure";

interface SettingsContentBoundaryProps {
  section: SettingsSection;
  children: ReactNode;
}

interface SettingsContentErrorBoundaryProps extends SettingsContentBoundaryProps {
  /**
   * Injected from the functional wrapper below, which reads the product
   * telemetry facade. A class component cannot call hooks, so the capture
   * callback arrives as a prop; the transport and payload are unchanged.
   */
  captureException: (error: unknown, context?: ErrorContext) => void;
}

interface SettingsContentBoundaryState {
  error: Error | null;
  detailsOpen: boolean;
}

class SettingsContentErrorBoundary extends React.Component<
  SettingsContentErrorBoundaryProps,
  SettingsContentBoundaryState
> {
  state: SettingsContentBoundaryState = {
    error: null,
    detailsOpen: false,
  };

  // Partial by design: a caught error must not reset `detailsOpen`, which the
  // Disclosure below owns.
  static getDerivedStateFromError(
    error: Error,
  ): Pick<SettingsContentBoundaryState, "error"> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.props.captureException(error, {
      tags: {
        action: "render_section",
        domain: "settings",
        route: "settings",
        settings_section: this.props.section,
      },
      extras: {
        component_stack: errorInfo.componentStack,
      },
      fingerprint: ["desktop", "settings", this.props.section],
    });
  }

  componentDidUpdate(prevProps: SettingsContentErrorBoundaryProps): void {
    if (prevProps.section !== this.props.section && this.state.error) {
      this.setState({ error: null });
    }
  }

  private handleRetry = () => {
    this.setState({ error: null });
  };

  private handleDetailsOpenChange = (open: boolean) => {
    this.setState({ detailsOpen: open });
  };

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      // w-full max-w-[50rem]: SettingsScreen's page-width contract used to
      // live on a wrapper around this boundary; now that panes carry it
      // themselves via SettingsPageBody, the error fallback — the one thing
      // this boundary renders that isn't a pane — carries it directly so it
      // doesn't regress to full-bleed width.
      <section className="w-full max-w-[50rem] space-y-4 py-8">
        <div className="space-y-1">
          <h2 className="text-heading font-medium">{SETTINGS_COPY.errorTitle}</h2>
          <p className="text-body text-muted-foreground">
            {SETTINGS_COPY.errorDescription}
          </p>
        </div>
        <Button variant="secondary" onClick={this.handleRetry}>
          {SETTINGS_COPY.errorRetry}
        </Button>
        <Disclosure
          className="rounded-lg border border-border/60 bg-surface-elevated-secondary px-4 py-3 text-body"
          chevronSide="trailing"
          open={this.state.detailsOpen}
          onOpenChange={this.handleDetailsOpenChange}
          title={SETTINGS_COPY.errorDetailsLabel}
        >
          <p className="mt-3 break-words text-muted-foreground">
            {this.state.error.message || this.state.error.name}
          </p>
        </Disclosure>
      </section>
    );
  }
}

/**
 * Functional wrapper that binds the product telemetry facade's `captureException`
 * and passes it to the class error boundary as a prop. This is the seam that
 * keeps the class free of a direct vendor/telemetry-client import while a class
 * component cannot itself call `useProductTelemetry()`.
 */
export function SettingsContentBoundary(
  props: SettingsContentBoundaryProps,
): React.ReactElement {
  const telemetry = useProductTelemetry();
  return (
    <SettingsContentErrorBoundary {...props} captureException={telemetry.captureException} />
  );
}
