import { Component, type ErrorInfo, type ReactNode } from "react";
import {
  diagnosticField,
  recordRendererDiagnostic,
} from "#product/lib/infra/diagnostics/renderer-diagnostics-port";
import { safeRendererErrorMessage } from "#product/lib/infra/diagnostics/renderer-diagnostic-values";

export class TerminalErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const errorMessage = safeRendererErrorMessage(error);
    recordRendererDiagnostic({
      name: "renderer.terminal.render_failed",
      severity: "error",
      kind: "message",
      privacy: "sensitive",
      fields: {
        message: diagnosticField(errorMessage, "sensitive"),
        component_stack: diagnosticField(info.componentStack ?? "[none]", "sensitive"),
      },
      errorClassification: "terminal_render_failed",
    });
    console.warn("[TerminalErrorBoundary] xterm render error caught:", errorMessage, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full items-center justify-center text-ui-sm text-muted-foreground">
          Terminal crashed - switch tabs to recover
        </div>
      );
    }
    return this.props.children;
  }
}
