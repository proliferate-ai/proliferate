import { Component, type ErrorInfo, type ReactNode } from "react";

export class TerminalErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn("[TerminalErrorBoundary] xterm render error caught:", error.message, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Terminal crashed - switch tabs to recover
        </div>
      );
    }
    return this.props.children;
  }
}
