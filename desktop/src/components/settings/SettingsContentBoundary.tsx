import React, { type ErrorInfo, type ReactNode } from "react";
import { SETTINGS_COPY, type SettingsSection } from "@/config/settings";
import { captureTelemetryException } from "@/lib/integrations/telemetry/client";
import { Button } from "@/components/ui/Button";

interface SettingsContentBoundaryProps {
  section: SettingsSection;
  children: ReactNode;
}

interface SettingsContentBoundaryState {
  error: Error | null;
}

export class SettingsContentBoundary extends React.Component<
  SettingsContentBoundaryProps,
  SettingsContentBoundaryState
> {
  state: SettingsContentBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): SettingsContentBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    captureTelemetryException(error, {
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

  componentDidUpdate(prevProps: SettingsContentBoundaryProps): void {
    if (prevProps.section !== this.props.section && this.state.error) {
      this.setState({ error: null });
    }
  }

  private handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <section className="space-y-4 py-8">
        <div className="space-y-1">
          <h2 className="text-lg font-medium">{SETTINGS_COPY.errorTitle}</h2>
          <p className="text-sm text-muted-foreground">
            {SETTINGS_COPY.errorDescription}
          </p>
        </div>
        <Button variant="secondary" onClick={this.handleRetry}>
          {SETTINGS_COPY.errorRetry}
        </Button>
        <details className="rounded-lg border border-border/60 bg-card/60 px-4 py-3 text-sm">
          <summary className="cursor-pointer select-none text-muted-foreground">
            {SETTINGS_COPY.errorDetailsLabel}
          </summary>
          <p className="mt-3 break-words text-muted-foreground">
            {this.state.error.message || this.state.error.name}
          </p>
        </details>
      </section>
    );
  }
}
