"use client";

import { Button } from "@/components/ui/button";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
	children: ReactNode;
}

interface State {
	hasError: boolean;
	error: Error | null;
}

export class PanelErrorBoundary extends Component<Props, State> {
	constructor(props: Props) {
		super(props);
		this.state = { hasError: false, error: null };
	}

	static getDerivedStateFromError(error: Error): State {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, errorInfo: ErrorInfo) {
		console.error("PanelErrorBoundary caught an error:", error, errorInfo);
	}

	render() {
		if (this.state.hasError) {
			return (
				<div className="flex h-full flex-col items-center justify-center gap-3 p-4">
					<p className="text-sm font-medium">Something went wrong</p>
					{this.state.error?.message && (
						<p className="max-w-xs text-center text-xs text-muted-foreground">
							{this.state.error.message}
						</p>
					)}
					<Button
						variant="outline"
						size="sm"
						onClick={() => this.setState({ hasError: false, error: null })}
					>
						Retry
					</Button>
				</div>
			);
		}

		return this.props.children;
	}
}
