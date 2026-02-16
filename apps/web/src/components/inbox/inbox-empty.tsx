"use client";

import { Inbox } from "lucide-react";

export function InboxEmpty() {
	return (
		<div className="flex flex-col items-center justify-center py-24 text-center">
			<div className="h-12 w-12 rounded-xl border border-border bg-muted flex items-center justify-center mb-4">
				<Inbox className="h-5 w-5 text-muted-foreground" />
			</div>
			<h2 className="text-sm font-medium mb-1">Inbox Zero</h2>
			<p className="text-muted-foreground text-xs max-w-[16rem]">
				Your agents are working quietly. Approvals and paused runs will appear here.
			</p>
		</div>
	);
}
