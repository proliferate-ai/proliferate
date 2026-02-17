"use client";

import { CheckCircle2 } from "lucide-react";

export function InboxEmpty() {
	return (
		<div className="flex flex-col items-center justify-center py-20 text-center">
			<CheckCircle2 className="h-10 w-10 text-muted-foreground/20 mb-4" />
			<h2 className="text-sm font-medium text-foreground mb-1">All clear</h2>
			<p className="text-xs text-muted-foreground">
				Your agents are working quietly in the background.
			</p>
		</div>
	);
}
