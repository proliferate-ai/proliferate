"use client";

import {
	InboxIllustration,
	InfoBadge,
	PageEmptyState,
} from "@/components/dashboard/page-empty-state";

export function InboxEmpty() {
	return (
		<PageEmptyState
			illustration={<InboxIllustration />}
			badge={<InfoBadge />}
			title="Inbox is empty"
			description="Agent runs requiring your attention will appear here."
		/>
	);
}
