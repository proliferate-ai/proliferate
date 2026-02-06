"use client";

import { Button } from "@/components/ui/button";

interface ActionErrorProps {
	error: string | null;
	onDismiss: () => void;
}

export function ActionError({ error, onDismiss }: ActionErrorProps) {
	if (!error) return null;

	return (
		<div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
			<p className="text-sm text-destructive">{error}</p>
			<Button variant="ghost" size="sm" className="mt-1 h-6 text-xs" onClick={onDismiss}>
				Dismiss
			</Button>
		</div>
	);
}
