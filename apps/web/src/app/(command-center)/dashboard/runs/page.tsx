"use client";

import { InboxEmpty } from "@/components/inbox/inbox-empty";
import { InboxItem } from "@/components/inbox/inbox-item";
import { Badge } from "@/components/ui/badge";
import { useAttentionInbox } from "@/hooks/use-attention-inbox";

export default function InboxPage() {
	const items = useAttentionInbox({ wsApprovals: [] });

	return (
		<div className="h-full overflow-y-auto">
			<div className="max-w-3xl mx-auto px-6 py-8">
				<div className="flex items-center gap-3 mb-6">
					<h1 className="text-xl font-semibold">Runs</h1>
					{items.length > 0 && <Badge variant="secondary">{items.length}</Badge>}
				</div>

				{items.length === 0 ? (
					<InboxEmpty />
				) : (
					<div className="flex flex-col gap-3">
						{items.map((item) => (
							<InboxItem
								key={item.type === "approval" ? item.data.approval.invocationId : item.data.id}
								item={item}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
