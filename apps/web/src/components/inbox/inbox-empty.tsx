"use client";

import { CheckCircle2 } from "lucide-react";

export function InboxEmpty() {
	return (
		<div className="flex flex-col items-center justify-center py-20 text-center">
			<CheckCircle2 className="h-12 w-12 text-muted-foreground/30 mb-4" />
			<h2 className="text-lg font-medium mb-1">All clear</h2>
			<p className="text-muted-foreground text-sm">No items need your attention</p>
		</div>
	);
}
